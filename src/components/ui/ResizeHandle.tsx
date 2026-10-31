import { useRef } from 'react'

/** Panels below the plot (measurements, spectrum): at least this high (px) … */
const MIN_HEIGHT = 90
/** … and at most this share of the window */
const MAX_SHARE = 0.6

interface Props {
  /** The panel's height, or its limit; null when there is none */
  height: number | null
  setHeight: (h: number) => void
  /** How high the panel is now, if that is not `height` (a panel that is only as high as its content) */
  getHeight?: () => number
  /** How high the panel can usefully be (its content): a drag stops there */
  maxHeight?: () => number
  /** A double-click: back to the height that fits the content */
  onReset?: () => void
}

/** The top edge of a panel below the plot: drag it to resize the panel */
export function ResizeHandle({ height, setHeight, getHeight, maxHeight, onReset }: Props) {
  const drag = useRef<{ y0: number; h0: number } | null>(null)
  const end = () => {
    drag.current = null
  }
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      title={onReset ? 'Drag to resize · double-click to fit the rows' : 'Drag to resize'}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y0: e.clientY, h0: getHeight?.() ?? height ?? MIN_HEIGHT }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const limit = Math.min(window.innerHeight * MAX_SHARE, maxHeight?.() ?? Infinity)
        setHeight(Math.round(Math.max(MIN_HEIGHT, Math.min(limit, drag.current.h0 - (e.clientY - drag.current.y0)))))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
    />
  )
}
