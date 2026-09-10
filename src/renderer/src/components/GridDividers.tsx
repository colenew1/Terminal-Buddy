import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { resizePair } from '../lib/grid-sizing'

type Axis = 'columns' | 'rows'
interface Drag {
  axis: Axis
  index: number
  origin: number
  extent: number
  weights: number[]
}

/** Dividers occupy the gaps, not a terminal's mouse-input surface. */
export default function GridDividers({ columns, rows, lastRowCount }: { columns: number[]; rows: number[]; lastRowCount: number }): React.JSX.Element {
  const drag = useRef<Drag | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const stop = (): void => { drag.current = null; setActive(null) }
  useEffect(() => {
    stop()
    window.addEventListener('blur', stop)
    return () => window.removeEventListener('blur', stop)
  }, [columns.length, rows.length])

  const layoutFor = (el: HTMLElement, axis: Axis, fallback: number[]): { extent: number; weights: number[] } => {
    const area = el.parentElement!
    const style = getComputedStyle(area)
    const pixels = (axis === 'columns' ? style.gridTemplateColumns : style.gridTemplateRows).split(' ').map(Number.parseFloat)
    const extent = axis === 'columns'
      ? area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.columnGap) * (fallback.length - 1)
      : area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.rowGap) * (fallback.length - 1)
    // Read actual sizes: a smaller window may have clamped a saved ratio to its minimum.
    return { extent, weights: pixels.length === fallback.length && pixels.every((n) => Number.isFinite(n) && n > 0)
      ? pixels.map((n) => n / pixels.reduce((sum, value) => sum + value, 0)) : fallback }
  }
  const apply = (d: Drag, delta: number): void => {
    useStore.getState().setGridSizes(d.axis, resizePair(d.weights, d.index, delta, d.extent, d.axis === 'columns' ? 160 : 110))
  }

  return <>{(['columns', 'rows'] as const).flatMap((axis) => {
    const weights = axis === 'columns' ? columns : rows
    return weights.slice(0, -1).map((weight, index) => {
      const name = `${axis}-${index}`
      // Stop internal column dividers above the final row's spanning pane.
      const columnRowEnd = index >= lastRowCount - 1 ? rows.length : -1
      return <div key={name} className={`grid-divider ${axis === 'columns' ? 'is-vertical' : 'is-horizontal'} ${active === name ? 'is-resizing' : ''}`}
        data-axis={axis} data-divider-index={index} role="separator" tabIndex={0}
        aria-label={`Resize ${axis === 'columns' ? 'columns' : 'rows'} ${index + 1} and ${index + 2}`}
        aria-orientation={axis === 'columns' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(100 * weight / (weight + weights[index + 1]))} aria-valuemin={0} aria-valuemax={100}
        title="Drag to resize • Arrow keys for fine adjustment • Double-click to balance"
        style={axis === 'columns' ? { gridColumn: index + 1, gridRow: `1 / ${columnRowEnd}` } : { gridRow: index + 1, gridColumn: '1 / -1' }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { axis, index, origin: axis === 'columns' ? event.clientX : event.clientY,
            ...layoutFor(event.currentTarget, axis, weights) }
          setActive(name)
        }}
        onPointerMove={(event) => {
          const d = drag.current
          if (d) apply(d, (d.axis === 'columns' ? event.clientX : event.clientY) - d.origin)
        }}
        onPointerUp={(event) => {
          stop()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={stop} onLostPointerCapture={stop}
        onDoubleClick={(event) => {
          const next = layoutFor(event.currentTarget, axis, weights).weights
          next[index] = next[index + 1] = (next[index] + next[index + 1]) / 2
          useStore.getState().setGridSizes(axis, next)
        }}
        onKeyDown={(event) => {
          const negative = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp'
          const positive = axis === 'columns' ? 'ArrowRight' : 'ArrowDown'
          if (event.key !== negative && event.key !== positive) return
          event.preventDefault()
          event.stopPropagation()
          apply({ axis, index, origin: 0, ...layoutFor(event.currentTarget, axis, weights) },
            (event.key === positive ? 1 : -1) * (event.shiftKey ? 40 : 8))
        }}><span aria-hidden="true" /></div>
    })
  })}</>
}
