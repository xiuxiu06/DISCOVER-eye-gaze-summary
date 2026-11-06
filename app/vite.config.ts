import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const ANTHROPIC_VERSION = '2023-06-01'
const FALLBACK_MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 32768

function loadDotenvKey(varName: string): string | undefined {
  const envVal = process.env[varName]?.trim()
  if (envVal && envVal !== 'sk-ant-your-key-here') return envVal

  const candidates = [
    fileURLToPath(new URL('../.env', import.meta.url)),
    fileURLToPath(new URL('./.env', import.meta.url)),
  ]
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    const content = readFileSync(filePath, 'utf8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const eq = line.indexOf('=')
      const k = line.slice(0, eq).trim()
      const v = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim()
      if (k === varName && v && v !== 'sk-ant-your-key-here') return v
    }
  }
  return undefined
}

async function resolveClaudeModel(apiKey: string): Promise<string> {
  const envModel = loadDotenvKey('ANTHROPIC_MODEL')
  if (envModel) return envModel

  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    })
    if (resp.ok) {
      const payload = (await resp.json()) as {
        data?: { id?: string; created_at?: string }[]
      }
      const models = [...(payload.data ?? [])].filter((m) => typeof m.id === 'string')
      models.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      const sonnet = models.find((m) => m.id!.toLowerCase().includes('sonnet'))
      if (sonnet?.id) return sonnet.id
      if (models[0]?.id) return models[0].id
    }
  } catch {
    // Fall back to default model on lookup failure.
  }
  return FALLBACK_MODEL
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function attachClaudeMiddleware(middlewares: {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
}): void {
  middlewares.use((req, res, next) => {
    const url = req.url?.split('?')[0]
    if (url === '/api/claude-status' && req.method === 'GET') {
      sendJson(res, 200, { hasServerKey: Boolean(loadDotenvKey('ANTHROPIC_API_KEY')) })
      return
    }
    if (url === '/api/match-lanes' && req.method === 'POST') {
      void (async () => {
        try {
          const body = await readJsonBody(req)
          const explicitKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
          const apiKey = explicitKey || loadDotenvKey('ANTHROPIC_API_KEY')
          if (!apiKey) {
            sendJson(res, 400, {
              error:
                'No Anthropic API key found. Paste your API key in the prompt or add ANTHROPIC_API_KEY=sk-ant-... to .env.',
            })
            return
          }
          const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : ''
          const userMessage = typeof body.userMessage === 'string' ? body.userMessage : ''
          if (!userMessage) {
            sendJson(res, 400, { error: 'Missing userMessage in request body.' })
            return
          }

          const model = await resolveClaudeModel(apiKey)
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: MAX_TOKENS,
              stream: true,
              system: systemPrompt,
              messages: [{ role: 'user', content: userMessage }],
            }),
          })

          if (!upstream.ok) {
            const errBody = await upstream.text()
            sendJson(res, upstream.status, {
              error: `Claude API HTTP ${upstream.status} (model='${model}'): ${errBody}`,
            })
            return
          }

          if (!upstream.body) {
            sendJson(res, 502, { error: 'Claude API returned an empty stream.' })
            return
          }

          const reader = upstream.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let modelUsed = model
          let stopReason: string | undefined
          const textChunks: string[] = []

          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const rawLine of lines) {
              const line = rawLine.trim()
              if (!line.startsWith('data:')) continue
              const dataStr = line.slice(5).trim()
              if (!dataStr || dataStr === '[DONE]') continue
              const evt = JSON.parse(dataStr) as {
                type?: string
                message?: { model?: string }
                delta?: { type?: string; text?: string; stop_reason?: string }
                error?: unknown
              }
              if (evt.type === 'message_start' && evt.message?.model) {
                modelUsed = evt.message.model
              } else if (
                evt.type === 'content_block_delta' &&
                evt.delta?.type === 'text_delta' &&
                evt.delta.text
              ) {
                textChunks.push(evt.delta.text)
              } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
                stopReason = evt.delta.stop_reason
              } else if (evt.type === 'error') {
                throw new Error(`Claude stream error: ${JSON.stringify(evt.error)}`)
              }
            }
          }

          if (stopReason === 'max_tokens') {
            sendJson(res, 502, {
              error: `Claude hit max_tokens=${MAX_TOKENS} before finishing lane classification.`,
            })
            return
          }

          sendJson(res, 200, { text: textChunks.join('').trim(), modelUsed, stopReason })
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
      return
    }
    next()
  })
}

function claudeApiPlugin(): Plugin {
  return {
    name: 'discover-claude-lane-matcher',
    configureServer(server) {
      attachClaudeMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      attachClaudeMiddleware(server.middlewares)
    },
  }
}

export default defineConfig({
  // Relative paths so a build works from any folder during an offline demo.
  base: './',
  plugins: [react(), tailwindcss(), claudeApiPlugin()],
  // The upload feature bundles the lane map, which lives outside app/.
  server: { fs: { allow: ['.', '../data/lane_map.csv'] }, proxy: { '/api': 'http://127.0.0.1:8000' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
