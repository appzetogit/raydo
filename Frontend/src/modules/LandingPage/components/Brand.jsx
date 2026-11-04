export const RAYDO_ICON = '/brand/raydo-icon-192.png'

// App icon + wordmark, for the black navbar and footer.
export function BrandLockup({ className = '' }) {
  return (
    <span className={`flex items-center gap-3 ${className}`}>
      <img src={RAYDO_ICON} alt="" width="40" height="40" className="h-10 w-10" />
      <span className="rd-display text-[2rem] text-white">Raydo</span>
    </span>
  )
}
