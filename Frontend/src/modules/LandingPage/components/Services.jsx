import { ArrowRight } from 'lucide-react'

const LANES = [
  {
    id: 'rides',
    title: 'Rides',
    body: 'See the fare before you book, then watch your driver come to you.',
    items: ['Cabs', 'Autos', 'Bikes', 'Parcels', 'Airport trips', 'Rentals'],
    href: '/taxi/user',
    cta: 'Book a ride',
  },
  {
    id: 'food',
    title: 'Food',
    body: 'Order from restaurants near you and follow it from their kitchen to your door.',
    items: ['Restaurants nearby', 'Live order tracking', 'UPI, cards or cash'],
    href: '/food/user',
    cta: 'Order food',
  },
]

export default function Services() {
  return (
    <section className="bg-[var(--rd-black)] text-white">
      {LANES.map(({ id, title, body, items, href, cta }) => (
        <div key={id}>
          <div className="rd-road-line" />
          <a id={id} href={href} className="rd-lane block scroll-mt-[4.5rem]" aria-label={cta}>
            <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-14 sm:px-8 lg:grid-cols-12 lg:items-center lg:py-20">
              <h2 className="rd-display rd-lane-title lg:col-span-5">{title}</h2>
              <div className="lg:col-span-5">
                <p className="max-w-lg text-2xl font-semibold leading-snug">{body}</p>
                <p className="rd-lane-note mt-5 max-w-lg text-lg text-white/70">{items.join('  /  ')}</p>
              </div>
              <span className="flex items-center gap-3 text-xl font-bold lg:col-span-2 lg:justify-end">
                {cta} <ArrowRight className="h-6 w-6 shrink-0" />
              </span>
            </div>
          </a>
        </div>
      ))}
      <div className="rd-road-line" />
    </section>
  )
}
