/** The app mark (same drawing as the favicon) */
export function Logo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className="logo">
      <path d="M3 20h6l3-10 4 14 3-9 2 5h8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
