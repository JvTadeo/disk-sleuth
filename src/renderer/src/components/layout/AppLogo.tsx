/** The app mark: a tiny treemap on a dark tile (same drawing as resources/icon-small.svg). */
export function AppLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#18181b" />
      <rect x="5" y="5" width="12" height="22" rx="2.5" fill="#3b82f6" />
      <rect x="19" y="5" width="8" height="12" rx="2" fill="#f59e0b" />
      <rect x="19" y="19" width="8" height="8" rx="2" fill="#14b8a6" />
    </svg>
  )
}
