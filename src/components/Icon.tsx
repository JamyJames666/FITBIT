// One stroke weight, one grid, one cap style. Drawn here rather than pulled in
// as a dependency because the set is six glyphs and a unicode arrow is not an
// icon system.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type IconName = 'sun' | 'moon' | 'sync' | 'left' | 'right' | 'alert' | 'exit'

const PATHS: Record<IconName, JSX.Element> = {
  sun: (
    <>
      <circle cx="8" cy="8" r="3.1" {...STROKE} />
      <path d="M8 1.4v1.5M8 13.1v1.5M14.6 8h-1.5M2.9 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" {...STROKE} />
    </>
  ),
  moon: <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z" {...STROKE} />,
  sync: (
    <>
      <path d="M13.6 7.1A5.7 5.7 0 0 0 3.6 4.6" {...STROKE} />
      <path d="M2.4 8.9a5.7 5.7 0 0 0 10 2.5" {...STROKE} />
      <path d="M13.9 3.4v3.7h-3.7M2.1 12.6V8.9h3.7" {...STROKE} />
    </>
  ),
  left: <path d="M9.8 3.5 5.3 8l4.5 4.5" {...STROKE} />,
  right: <path d="M6.2 3.5 10.7 8l-4.5 4.5" {...STROKE} />,
  alert: (
    <>
      <path d="M8 2.8 1.9 13.2h12.2L8 2.8Z" {...STROKE} />
      <path d="M8 6.6v3.1M8 11.5h.01" {...STROKE} />
    </>
  ),
  exit: (
    <>
      <path d="M6.2 13.4H3.4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1h2.8" {...STROKE} />
      <path d="M10.4 11.1 13.5 8l-3.1-3.1M13.5 8H6.1" {...STROKE} />
    </>
  ),
}

export default function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}
