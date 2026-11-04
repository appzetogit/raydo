export const RAYDO_MARK = '/brand/raydo-mark.png'
export const RAYDO_LOGO = '/brand/raydo-logo.png'

// Mark + wordmark lockup. `tone="light"` is for dark backgrounds, where the black
// half of the wordmark would disappear.
export function BrandLockup({ tone = 'dark', className = '' }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <img src={RAYDO_MARK} alt="" className="h-9 w-auto" />
      <span
        className={`font-[Outfit] text-2xl font-extrabold tracking-tight ${tone === 'light' ? 'text-white' : 'text-raydo-ink'}`}
      >
        Raydo
      </span>
    </span>
  )
}

// The swoosh along the foot of the Raydo app icon.
export function BrandWave({ className = '', color = '#ffc400' }) {
  return (
    <svg className={className} viewBox="0 0 1440 200" preserveAspectRatio="none" aria-hidden="true">
      <path fill={color} fillOpacity="0.35" d="M0,120 C260,200 520,210 780,160 C1040,110 1260,40 1440,30 L1440,200 L0,200 Z" />
      <path fill={color} d="M0,170 C300,210 620,200 900,160 C1120,128 1300,96 1440,92 L1440,200 L0,200 Z" />
    </svg>
  )
}
