import { line, scaleLinear, scaleSqrt, select, zoom, zoomIdentity, type ZoomBehavior } from 'd3'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { topObjects, type Interval } from '../metrics'
import { formatClock, formatDuration, formatElapsed } from '../time'
import type { Lane, Meta, Visit } from '../types'

interface SwimChartProps {
  meta: Meta
  lanes: Lane[]
  learners: number[]
  window: Interval
  touchpoints: Visit[]
  /** Idle intervals by learner. Not drawn in overlay mode, which has no per-learner panel. */
  idle: { userId: number; start: number; end: number }[]
  ariaLabel: string
  /** Text next to each learner's name. */
  caption?: (userId: number) => string
  /** A single learner's chart has one panel, so it skips the name row. */
  showLearnerNames?: boolean
  overlay?: boolean
  laneHeight?: number
  scrubTime?: number
  onScrub?: (time: number) => void
  selected?: Visit
  onSelect?: (visit: Visit) => void
  toolbar?: ReactNode
}

const LEFT = 188
const RIGHT = 8
const TOP = 26
const NAME_ROW = 30
const LANE_GAP = 3
const PANEL_GAP = 16
const AXIS_HEIGHT = 24
const FONT = "'Inter Variable', Inter, system-ui, sans-serif"
const INK = '#15181E'
const MUTED = '#565D6B'
const LABEL_INK = '#3F4552'
const ZOOM_STEP = 1.6

/** Learner lines in overlay mode: dark neutrals and dashes, so they don't look like lanes. */
export const LEARNER_LINES = [
  { color: '#15181E', dash: '' },
  { color: '#15181E', dash: '7 4' },
  { color: '#6B7280', dash: '' },
  { color: '#6B7280', dash: '2 3' },
]

const dotRadius = scaleSqrt().domain([0.3, 15]).range([4, 10]).clamp(true)

function tickStep(visibleS: number): number {
  return [15, 30, 60, 120, 300, 600, 900].find((step) => visibleS / step <= 11) ?? 1200
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

export function SwimChart({
  meta,
  lanes,
  learners,
  window,
  touchpoints,
  idle,
  ariaLabel,
  caption,
  showLearnerNames = true,
  overlay = false,
  laneHeight = 22,
  scrubTime,
  onScrub,
  selected,
  onSelect,
  toolbar,
}: SwimChartProps) {
  const { ref, width } = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null)
  const dragging = useRef(false)
  const [transform, setTransform] = useState(zoomIdentity)
  const [hovered, setHovered] = useState<{ visit: Visit; x: number; y: number }>()

  const panels = overlay ? [undefined] : learners
  const nameRow = showLearnerNames ? NAME_ROW : 0
  const panelHeight = lanes.length * (laneHeight + LANE_GAP) - LANE_GAP
  const plotBottom = TOP + panels.length * (nameRow + panelHeight + PANEL_GAP) - PANEL_GAP
  const height = plotBottom + AXIS_HEIGHT
  const plotRight = Math.max(LEFT + 1, width - RIGHT)
  const panelTop = (index: number) => TOP + index * (nameRow + panelHeight + PANEL_GAP) + nameRow

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
      // The page scrolls, so wheel zoom needs Ctrl. Plain drag belongs to the scrubber.
      .filter(
        (event) =>
          (event.type === 'wheel' && (event.ctrlKey || event.metaKey)) ||
          (event.type === 'mousedown' && event.shiftKey),
      )
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
    onScrub?.(x.invert(px))
  }

  function zoomBy(factor: number) {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).call(zoomRef.current.scaleBy, factor, [(LEFT + plotRight) / 2, 0])
    }
  }

  const laneCenter = new Map(
    lanes.map((lane, index) => [lane.id, index * (laneHeight + LANE_GAP) + laneHeight / 2]),
  )
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
          strokeOpacity={0.55}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeDasharray={lineStyle.dash}
        />
        {visible.map((visit) => {
          const cx = x((visit.start + visit.end) / 2)
          const cy = laneCenter.get(visit.lane)!
          const radius = Math.min(dotRadius(visit.dwell), laneHeight / 2 + 3)
          const emphasized = hovered?.visit === visit || selected === visit
          return (
            <g key={`${visit.sessionId}-${visit.start}`}>
              <circle
                cx={cx}
                cy={cy}
                r={emphasized ? radius + 1.5 : radius}
                fill={laneById.get(visit.lane)!.color}
                stroke={emphasized ? INK : '#FFFFFF'}
                strokeWidth={1.2}
              />
              <circle
                data-testid="touchpoint-dot"
                cx={cx}
                cy={cy}
                r={Math.max(radius + 2, 7)}
                fill="transparent"
                className={onSelect ? 'cursor-pointer' : undefined}
                onPointerDown={(event) => {
                  if (!onSelect || event.shiftKey) return
                  event.stopPropagation()
                  onSelect(visit)
                }}
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
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 print:hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">{toolbar}</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ctrl+scroll to zoom · Shift+drag to pan</span>
          <Button variant="outline" size="sm" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Zoom out"
            disabled={!isZoomed}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            −
          </Button>
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
            Reset
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div ref={ref} className="relative min-w-[760px]">
          {width > 0 && (
            <svg
              ref={svgRef}
              data-export-chart
              xmlns="http://www.w3.org/2000/svg"
              width={width}
              height={height}
              role="img"
              aria-label={ariaLabel}
              fontFamily={FONT}
              className={`block select-none ${onScrub ? 'cursor-crosshair' : ''}`}
              onPointerDown={(event) => {
                if (!onScrub || event.shiftKey || event.button !== 0) return
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
                  width={6}
                  height={6}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width={6} height={6} fill="#FFFFFF" fillOpacity={0.55} />
                  <line x1={0} y1={0} x2={0} y2={6} stroke="#C3C8D1" strokeWidth={2} />
                </pattern>
              </defs>

              {!showLearnerNames && (
                <text x={0} y={14} fontSize={11} fill={MUTED}>
                  Minutes into the team run
                </text>
              )}

              {ticks.map((elapsed) => (
                <line
                  key={elapsed}
                  x1={x(window.start + elapsed)}
                  x2={x(window.start + elapsed)}
                  y1={TOP}
                  y2={plotBottom + 6}
                  stroke="#E7E9EE"
                  clipPath="url(#plot-clip)"
                />
              ))}

              {panels.map((userId, panelIndex) => {
                const top = panelTop(panelIndex)
                const panelIdle = idle.filter((item) => item.userId === userId)
                return (
                  <g key={userId ?? 'overlay'} transform={`translate(0 ${top})`}>
                    {showLearnerNames && (
                      <>
                        <text x={0} y={-11} fontSize={13} fontWeight={600} fill={INK}>
                          {userId === undefined ? 'All learners' : `Learner ${userId}`}
                        </text>
                        {userId !== undefined && caption && (
                          <text x={LEFT} y={-11} fontSize={11} fill={MUTED}>
                            {caption(userId)}
                          </text>
                        )}
                      </>
                    )}
                    {lanes.map((lane, laneIndex) => {
                      const y = laneIndex * (laneHeight + LANE_GAP)
                      return (
                        <g key={lane.id}>
                          <circle cx={6} cy={y + laneHeight / 2} r={4.5} fill={lane.color} />
                          <text x={17} y={y + laneHeight / 2 + 4} fontSize={laneHeight > 24 ? 12 : 11} fill={LABEL_INK}>
                            {lane.label}
                          </text>
                          <rect
                            x={LEFT}
                            y={y}
                            width={plotRight - LEFT}
                            height={laneHeight}
                            rx={4}
                            fill={lane.band}
                          />
                        </g>
                      )
                    })}
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
                            { color: '#3A4150', dash: '' },
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
                    y={18}
                    textAnchor="middle"
                    fontSize={11}
                    fill={MUTED}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatElapsed(elapsed)}
                  </text>
                ))}
              </g>

              {scrubVisible && (
                <g data-testid="scrubber">
                  <line x1={scrubX} x2={scrubX} y1={22} y2={plotBottom} stroke={INK} strokeWidth={1.5} />
                  <rect
                    x={Math.min(plotRight - 52, Math.max(LEFT, scrubX - 26))}
                    y={2}
                    width={52}
                    height={20}
                    rx={10}
                    fill={INK}
                  />
                  <text
                    x={Math.min(plotRight - 26, Math.max(LEFT + 26, scrubX))}
                    y={16}
                    fontSize={11}
                    fontWeight={600}
                    fill="#FFFFFF"
                    textAnchor="middle"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatElapsed(scrubTime! - window.start)}
                  </text>
                </g>
              )}
            </svg>
          )}

          {hovered && <DotTooltip meta={meta} width={width} hovered={hovered} laneById={laneById} />}
        </div>
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
  const placeLeft = hovered.x > width - 280
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-64 rounded-lg border border-input bg-white p-3 text-xs shadow-md"
      style={{
        top: Math.max(4, hovered.y - 16),
        left: placeLeft ? hovered.x - 276 : hovered.x + 14,
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
