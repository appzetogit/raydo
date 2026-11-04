import { Apple, Play } from 'lucide-react'

// Store links come from the admin landing-page settings; a badge is hidden until
// its URL is set, rather than pointing at someone else's app.
export default function StoreBadges({ settings, tone = 'dark', className = '' }) {
  const links = [
    { href: settings?.play_store_url, label: 'Google Play', caption: 'Get it on', Icon: Play },
    { href: settings?.app_store_url, label: 'App Store', caption: 'Download on the', Icon: Apple },
  ].filter((l) => l.href)

  if (!links.length) return null

  const style =
    tone === 'light'
      ? 'bg-white text-[var(--rd-black)]'
      : 'bg-[var(--rd-black)] text-white'

  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {links.map(({ href, label, caption, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-3 px-5 py-2.5 ${style}`}
        >
          <Icon className="h-6 w-6" />
          <span className="text-left leading-tight">
            <span className="block text-[10px] uppercase tracking-wide opacity-70">{caption}</span>
            <span className="block text-base font-semibold">{label}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
