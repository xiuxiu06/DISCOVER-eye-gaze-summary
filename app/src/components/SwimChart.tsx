import { line, scaleLinear, scaleSqrt, select, zoom, zoomIdentity, type ZoomBehavior } from 'd3'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { topObjects, type Coverage, type Interval } from '../metrics'
import { formatClock, formatDuration, formatElapsed } from '../time'
import type { Lane, Meta, Visit } from '../types'

export interface CoverageRow {
  lane: Lane
  coverage: Coverage
}

interface SwimChartProps {
  meta: Meta
  lanes: Lane[]
  learners: number[]
  window: Interval
  touchpoints: Visit[]
  /** Idle intervals by learner. Not drawn in overlay mode, which has no per-learner panel. */
  idle: { userId: number; start: number; end: number }[]
  coverage: CoverageRow[]
  overlay: boolean
  scrubTime: number | undefined
  onScrub: (time: number) => void
  toolbar: ReactNode
}

const LEARNER_COLUMN = 22
const LABEL_WIDTH = 158
const LEFT = LEARNER_COLUMN + LABEL_WIDTH + 6
const RIGHT = 14
const COVERAGE_ROW = 14
const COVERAGE_GAP = 10
const AXIS_HEIGHT = 24
const PANEL_GAP = 7
const MIN_LANE_HEIGHT = 14
const MAX_LANE_HEIGHT = 44
const INK = '#2b3440'
const UNCOVERED = '#C62828'

/** Learner lines in overlay mode: dark neutrals and dashes, so they don't look like lanes. */
export const LEARNER_LINES = [
  { color: '#111827', dash: '' },
  { color: '#111827', dash: '7 4' },
  { color: '#6b7280', dash: '' },
  { color: '#6b7280', dash: '2 3' },
]

const dotRadius = scaleSqrt().domain([0.3, 15]).range([3, 8]).clamp(true)

/** Black or white text, whichever reads better on a lane's label block. */
function labelInk(hex: string): string {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05 ? '#fff' : '#111'
}

function tickStep(visibleS: number): number {
  return [15, 30, 60, 120, 300, 600, 900].find((step) => visibleS / step <= 10) ?? 1200
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, ...size }
}

export function SwimChart({
  meta,
  lanes,
  learners,
  window,
  touchpoints,
  idle,
  coverage,
  overlay,
  scrubTime,
  onScrub,
  toolbar,
}: SwimChartProps) {
  const { ref, width, height: availableHeight } = useSize()
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null)
  const dragging = useRef(false)
  const [transform, setTransform] = useState(zoomIdentity)
  const [hovered, setHovered] = useState<{ visit: Visit; x: number; y: number }>()

  const panels = overlay ? [undefined] : learners
  const coverageHeight = coverage.length * COVERAGE_ROW + COVERAGE_GAP
  const laneHeight = Math.min(
    MAX_LANE_HEIGHT,
    Math.max(
      MIN_LANE_HEIGHT,
      Math.floor(
        (availableHeight - coverageHeight - AXIS_HEIGHT - PANEL_GAP * panels.length) /
          (panels.length * lanes.length),
      ),
    ),
  )
  const panelHeight = laneHeight * lanes.length
  const plotBottom = coverageHeight + panels.length * (panelHeight + PANEL_GAP)
  const height = plotBottom + AXIS_HEIGHT
  const plotRight = Math.max(LEFT + 1, width - RIGHT)

  const x = useMemo(() => {
    const base = scaleLinear().domain([window.start, window.end]).range([LEFT, plotRight])
    return transform.rescaleX(base)
  }, [window.start, window.end, plotRight, transform])

  useEffect(() => {
    if (!svgRef.current || width === 0) return
    const selection = select(svgRef.current)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 40])
      .extent([
        [LEFT, 0],
        [plotRight, height],
      ])
      .translateExtent([
        [LEFT, 0],
        [plotRight, height],
      ])
      // Plain drag belongs to the scrubber, so panning needs Shift.
      .filter((event) => event.type === 'wheel' || (event.type === 'mousedown' && event.shiftKey))
      .on('zoom', (event) => setTransform(event.transform))
    selection.call(behavior)
    zoomRef.current = behavior
    return () => {
      selection.on('.zoom', null)
    }
  }, [width, height, plotRight])

  const [visibleStart, visibleEnd] = x.domain()
  const step = tickStep(visibleEnd - visibleStart)
  const ticks: number[] = []
  const firstTick = Math.ceil((visibleStart - window.start) / step) * step
  for (let elapsed = firstTick; window.start + elapsed <= visibleEnd; elapsed += step) {
    ticks.push(elapsed)
  }

  function scrubFromPointer(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const px = Math.min(plotRight, Math.max(LEFT, event.clientX - box.left))
    onScrub(x.invert(px))
  }

  function panelTop(index: number) {
    return coverageHeight + index * (panelHeight + PANEL_GAP)
  }
  const laneCenter = new Map(lanes.map((lane, index) => [lane.id, (index + 0.5) * laneHeight]))
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]))

  function learnerGroup(items: Visit[], lineStyle: { color: string; dash: string }, key: string) {
    const visible = items.filter((visit) => laneCenter.has(visit.lane))
    const path = line<Visit>()
      .x((visit) => x((visit.start + visit.end) / 2))
      .y((visit) => laneCenter.get(visit.lane)!)
    return (
      <g key={key}>
        <path
          d={path(visible) ?? undefined}
          fill="none"
          stroke={lineStyle.color}
          strokeOpacity={0.75}
          strokeWidth={1}
          strokeDasharray={lineStyle.dash}
        />
        {visible.map((visit) => {
          const cx = x((visit.start + visit.end) / 2)
          const cy = laneCenter.get(visit.lane)!
          const radius = dotRadius(visit.dwell)
          const isHovered = hovered?.visit === visit
          return (
            <g key={`${visit.sessionId}-${visit.start}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? radius + 1.5 : radius}
                fill={laneById.get(visit.lane)!.color}
                stroke={INK}
                strokeWidth={isHovered ? 1.5 : 0.75}
              />
              <circle
                data-testid="touchpoint-dot"
                cx={cx}
                cy={cy}
                r={Math.max(radius + 3, 7)}
                fill="transparent"
                onPointerEnter={(event) => {
                  if (dragging.current) return
                  const box = ref.current!.getBoundingClientRect()
                  setHovered({ visit, x: event.clientX - box.left, y: event.clientY - box.top })
                }}
                onPointerLeave={() => setHovered(undefined)}
              />
            </g>
          )
        })}
      </g>
    )
  }

  const scrubX = scrubTime === undefined ? undefined : x(scrubTime)
  const scrubVisible = scrubX !== undefined && scrubX >= LEFT && scrubX <= plotRight
  const isZoomed = transform.k !== 1

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {toolbar}
        <span className="ml-auto">Click or drag to scrub · Scroll to zoom · Shift+drag to pan</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!isZoomed}
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              select(svgRef.current).call(zoomRef.current.transform, zoomIdentity)
            }
          }}
        >
          Reset zoom
        </Button>
      </div>

      <div ref={ref} className="relative min-h-0 flex-1 overflow-y-auto">
        {width > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            role="img"
            aria-label="Swim lanes of each learner's touchpoints over time, with a team coverage strip"
            className="block cursor-crosshair select-none"
            onPointerDown={(event) => {
              if (event.shiftKey || event.button !== 0) return
              dragging.current = true
              setHovered(undefined)
              event.currentTarget.setPointerCapture(event.pointerId)
              scrubFromPointer(event)
            }}
            onPointerMove={(event) => {
              if (dragging.current) scrubFromPointer(event)
            }}
            onPointerUp={() => {
              dragging.current = false
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            <defs>
              <clipPath id="plot-clip">
                <rect x={LEFT} y={0} width={plotRight - LEFT} height={height} />
              </clipPath>
              <pattern
                id="idle-hatch"
                width={7}
                height={7}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width={7} height={7} fill="#fff" fillOpacity={0.72} />
                <line x1={0} y1={0} x2={0} y2={7} stroke="#6b7280" strokeWidth={1.5} />
              </pattern>
            </defs>

            {coverage.map((row, index) => {
              const top = index * COVERAGE_ROW
              return (
                <g key={row.lane.id} data-testid="coverage-row">
                  <text x={LEFT - 8} y={top + 10.5} textAnchor="end" fontSize={11} fill={INK}>
                    {row.lane.label}
                  </text>
                  <rect
                    x={LEFT}
                    y={top + 1}
                    width={plotRight - LEFT}
                    height={COVERAGE_ROW - 2}
                    fill={row.lane.band}
                  />
                  <g clipPath="url(#plot-clip)">
                    {row.coverage.uncovered.map((gap) => (
                      <rect
                        key={gap.start}
                        data-testid="uncovered"
                        x={x(gap.start)}
                        y={top + 1}
                        width={Math.max(1, x(gap.end) - x(gap.start))}
                        height={COVERAGE_ROW - 2}
                        fill={UNCOVERED}
                      >
                        <title>
                          {`${row.lane.label}: no learner looked for ${formatDuration(gap.end - gap.start)} from ${formatClock(gap.start)}`}
                        </title>
                      </rect>
                    ))}
                  </g>
                </g>
              )
            })}

            {panels.map((userId, panelIndex) => {
              const top = panelTop(panelIndex)
              const panelIdle = idle.filter((item) => item.userId === userId)
              return (
                <g key={userId ?? 'overlay'} transform={`translate(0 ${top})`}>
                  <text
                    transform={`translate(13 ${panelHeight / 2}) rotate(-90)`}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={INK}
                  >
                    {userId === undefined ? 'All learners' : `Learner ${userId}`}
                  </text>
                  {lanes.map((lane, laneIndex) => (
                    <g key={lane.id}>
                      <rect
                        x={LEARNER_COLUMN}
                        y={laneIndex * laneHeight + 0.5}
                        width={LABEL_WIDTH}
                        height={laneHeight - 1}
                        fill={lane.color}
                      />
                      <text
                        x={LEARNER_COLUMN + 6}
                        y={(laneIndex + 0.5) * laneHeight + 3.5}
                        fontSize={10.5}
                        fontWeight={500}
                        fill={labelInk(lane.color)}
                      >
                        {lane.label}
                      </text>
                      <rect
                        x={LEFT}
                        y={laneIndex * laneHeight + 0.5}
                        width={plotRight - LEFT}
                        height={laneHeight - 1}
                        fill={lane.band}
                      />
                    </g>
                  ))}
                  <g clipPath="url(#plot-clip)">
                    {panelIdle.map((item) => (
                      <rect
                        key={item.start}
                        data-testid="idle"
                        x={x(item.start)}
                        y={0}
                        width={Math.max(1, x(item.end) - x(item.start))}
                        height={panelHeight}
                        fill="url(#idle-hatch)"
                      >
                        <title>{`Idle headset, ${formatDuration(item.end - item.start)} from ${formatClock(item.start)}`}</title>
                      </rect>
                    ))}
                    {userId === undefined
                      ? learners.map((id, index) =>
                          learnerGroup(
                            touchpoints.filter((visit) => visit.userId === id),
                            LEARNER_LINES[index % LEARNER_LINES.length],
                            String(id),
                          ),
                        )
                      : learnerGroup(
                          touchpoints.filter((visit) => visit.userId === userId),
                          { color: INK, dash: '' },
                          String(userId),
                        )}
                  </g>
                </g>
              )
            })}

            <g transform={`translate(0 ${plotBottom})`}>
              {ticks.map((elapsed) => (
                <text
                  key={elapsed}
                  x={x(window.start + elapsed)}
                  y={14}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#5f6b76"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatElapsed(elapsed)}
                </text>
              ))}
            </g>

            {scrubVisible && (
              <line
                data-testid="scrubber"
                x1={scrubX}
                x2={scrubX}
                y1={0}
                y2={plotBottom}
                stroke="#111827"
                strokeWidth={1.5}
              />
            )}
          </svg>
        )}

        {hovered && <DotTooltip meta={meta} width={width} hovered={hovered} laneById={laneById} />}
      </div>
    </div>
  )
}

function DotTooltip({
  meta,
  width,
  hovered,
  laneById,
}: {
  meta: Meta
  width: number
  hovered: { visit: Visit; x: number; y: number }
  laneById: Map<string, Lane>
}) {
  const { visit } = hovered
  const objects = topObjects(visit, 3)
  const placeLeft = hovered.x > width - 240
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-56 rounded-md border bg-popover p-2.5 text-xs shadow-md"
      style={{
        top: Math.max(4, hovered.y - 16),
        left: placeLeft ? hovered.x - 236 : hovered.x + 14,
      }}
    >
      <div className="font-semibold">
        Learner {visit.userId} · {laneById.get(visit.lane)?.label ?? visit.lane}
      </div>
      <div className="mt-0.5 text-muted-foreground tabular-nums">
        {formatClock(visit.start)} · {formatDuration(visit.dwell)}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {objects.map(([objectId, seconds]) => (
          <li key={objectId} className="flex justify-between gap-3 tabular-nums">
            <span className="truncate">
              {objectId}
              {meta.objects[objectId]?.verify && (
                <span title="Lane mapping needs checking" className="ml-1 font-semibold">
                  ?
                </span>
              )}
            </span>
            <span>{seconds.toFixed(1)} s</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
