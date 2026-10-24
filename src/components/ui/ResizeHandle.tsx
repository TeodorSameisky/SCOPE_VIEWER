import { useRef } from 'react'

/** Panels below the plot (measurements, spectrum): at least this high (px) … */
const MIN_HEIGHT = 90
/** … and at most this share of the window */
const MAX_SHARE = 0.6

/** The top edge of a panel below the plot: drag it to resize the panel */
export function ResizeHandle({ height, setHeight }: { height: number; setHeight: (h: number) => void }) {
  const drag = useRef<{ y0: number; h0: number } | null>(null)
  const end = () => {
    drag.current = null
  }
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y0: e.clientY, h0: height }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        setHeight(Math.round(Math.min(window.innerHeight * MAX_SHARE, Math.max(MIN_HEIGHT, drag.current.h0 - (e.clientY - drag.current.y0)))))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  )
}
