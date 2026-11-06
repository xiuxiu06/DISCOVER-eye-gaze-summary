import { useRef } from 'react'
import { Button } from '@/components/ui/button'

/** Opens a file picker for a gaze log. The file stays in the browser. */
export function UploadLog({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,text/csv"
        className="hidden"
        data-testid="upload-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Clear it so choosing the same file again still fires a change.
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Reading…' : 'Upload CSV'}
      </Button>
    </>
  )
}
