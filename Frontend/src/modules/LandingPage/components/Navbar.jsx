import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { BrandLockup } from './Brand'

const LINKS = [
  { name: 'Rides', href: '#rides' },
  { name: 'Food', href: '#food' },
  { name: 'How it works', href: '#how' },
  { name: 'Partners', href: '#partners' },
  { name: 'FAQ', href: '#faq' },
]

const scrollTo = (e, href) => {
  e.preventDefault()
  document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-[var(--rd-black)] text-white">
      <nav className="mx-auto flex h-[4.5rem] max-w-[90rem] items-center justify-between px-4 sm:px-8">
        <a href="/" aria-label="Raydo home">
          <BrandLockup />
        </a>

        <div className="hidden items-center gap-9 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.name}
              href={link.href}
              onClick={(e) => scrollTo(e, link.href)}
              className="font-semibold text-white/80 transition-colors hover:text-[var(--rd-yellow)]"
            >
              {link.name}
            </a>
          ))}
        </div>

        <div className="hidden lg:block">
          <a href="/taxi/user" className="rd-btn rd-btn-yellow !px-6 !py-2.5 !text-base">
            <span>Book a ride</span>
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-2 lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/15 px-4 pb-6 pt-2 lg:hidden">
          {LINKS.map((link) => (
            <a
              key={link.name}
              href={link.href}
              onClick={(e) => {
                scrollTo(e, link.href)
                setOpen(false)
              }}
              className="block py-3 text-lg font-semibold"
            >
              {link.name}
            </a>
          ))}
          <a href="/taxi/user" className="rd-btn rd-btn-yellow mt-3 w-full">
            <span>Book a ride</span>
          </a>
        </div>
      )}
    </header>
  )
}
