import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { includedLanes } from '../metrics'
import { formatDay } from '../time'
import type { Dataset } from '../types'

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-white px-6 py-5', className)}>
      {children}
    </section>
  )
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 font-heading text-[17px] font-semibold">{children}</h2>
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 font-heading text-[30px] font-semibold tracking-[-0.015em]">{children}</h1>
}

export function StatCard({ value, label, note }: { value: ReactNode; label: string; note: string }) {
  return (
    <div data-testid="stat-card" className="flex flex-col gap-1.5 rounded-xl border bg-white px-6 py-5">
      <span className="font-heading text-[32px] font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      <span className="text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}

export function LaneDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color }}
    />
  )
}

/** The file name and any note in meta.source, which reads "file.csv. A note." */
function sourceParts(source: string): { name: string; note: string } {
  const split = source.indexOf('. ')
  return split === -1
    ? { name: source, note: '' }
    : { name: source.slice(0, split), note: source.slice(split + 2) }
}

export function sourceName(source: string): string {
  return sourceParts(source).name
}

/** Dates a dataset covers, e.g. "May 5–8, 2026". */
export function dateRange(dataset: Dataset): string {
  const dates = dataset.runs.map((run) => run.date).sort()
  if (dates.length === 0) return ''
  const first = formatDay(dates[0])
  const last = formatDay(dates[dates.length - 1])
  const year = dates[0].slice(0, 4)
  if (first === last) return `${first}, ${year}`
  return first.slice(0, 3) === last.slice(0, 3)
    ? `${first}–${last.slice(4)}, ${year}`
    : `${first}–${last}, ${year}`
}

export function verifyCount(dataset: Dataset): number {
  return Object.values(dataset.meta.objects).filter((info) => info.verify).length
}

export function PageFooter({ dataset }: { dataset: Dataset }) {
  const { name, note } = sourceParts(dataset.meta.source)
  const objects = Object.keys(dataset.meta.objects).length
  const lanes = includedLanes(dataset.meta).length
  return (
    <footer className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
      Head gaze (headset-forward ray): a ray cast from the center of the headset, not eye tracking.
      Source: {name} ({(dataset.funnel[0]?.rows ?? 0).toLocaleString('en-US')} rows,{' '}
      {dateRange(dataset)}). Lane mapping: {objects} objects to {lanes} lanes, {verifyCount(dataset)}{' '}
      flagged for the DISCOVER dev team to verify. {note}
    </footer>
  )
}
