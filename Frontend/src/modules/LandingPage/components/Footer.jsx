import { ArrowRight, Mail, Phone, MapPin } from 'lucide-react'
import { BrandLockup } from './Brand'
import StoreBadges from './StoreBadges'

const COLUMNS = [
  {
    title: 'Services',
    links: [
      { label: 'Book a ride', href: '/taxi/user' },
      { label: 'Order food', href: '/food/user' },
    ],
  },
  {
    title: 'Partners',
    links: [
      { label: 'Drive with Raydo', href: '/taxi/driver' },
      { label: 'List your restaurant', href: '/food/restaurant/login' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Support', href: '/support' },
      { label: 'Terms', href: '/terms?tab=terms' },
      { label: 'Privacy', href: '/terms?tab=privacy' },
    ],
  },
]

export default function Footer({ settings }) {
  // Contact details are only shown once they are set in the admin landing settings.
  const contacts = [
    { Icon: Phone, value: settings?.contact_phone, href: settings?.contact_phone && `tel:${settings.contact_phone}` },
    { Icon: Mail, value: settings?.contact_email, href: settings?.contact_email && `mailto:${settings.contact_email}` },
    { Icon: MapPin, value: settings?.contact_address },
  ].filter((c) => c.value)

  return (
    <footer>
      <section className="bg-[var(--rd-yellow)] py-16 lg:py-24">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-10 px-4 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="rd-display rd-hero-title">Where to?</h2>
          <div className="lg:pb-3">
            <div className="flex flex-col gap-4 sm:flex-row">
              <a href="/taxi/user" className="rd-btn rd-btn-black">
                <span>Book a ride</span> <ArrowRight className="h-5 w-5" />
              </a>
              <a href="/food/user" className="rd-btn rd-btn-line">
                <span>Order food</span> <ArrowRight className="h-5 w-5" />
              </a>
            </div>
            <StoreBadges settings={settings} className="mt-5" />
          </div>
        </div>
      </section>

      <div className="overflow-hidden bg-[var(--rd-black)] text-white">
        <div className="mx-auto grid max-w-[90rem] gap-12 px-4 py-16 sm:px-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <BrandLockup />
            {contacts.length > 0 && (
              <ul className="mt-6 space-y-3 text-white/70">
                {contacts.map(({ Icon, value, href }) => (
                  <li key={value} className="flex items-start gap-3">
                    <Icon className="mt-1 h-4 w-4 shrink-0 text-[var(--rd-yellow)]" />
                    {href ? <a href={href} className="hover:text-white">{value}</a> : <span>{value}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="font-bold text-[var(--rd-yellow)]">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-white/80 transition-colors hover:text-white">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mx-auto max-w-[90rem] px-4 pb-6 text-sm text-white/60 sm:px-8">
          © {new Date().getFullYear()} Raydo. All rights reserved.
        </p>
        <p aria-hidden="true" className="rd-display rd-footer-word select-none whitespace-nowrap text-center text-[var(--rd-yellow)]">
          Raydo
        </p>
      </div>
    </footer>
  )
}
