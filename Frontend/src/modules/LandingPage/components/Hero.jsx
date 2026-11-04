import { ArrowRight } from 'lucide-react'
import StoreBadges from './StoreBadges'

// The logo's road and speed lines, drawn large. It runs off the edge of the section.
function RoadArt({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 800 760" fill="none" aria-hidden="true" preserveAspectRatio="xMaxYMax slice">
      <g fill="#0b0b0b">
        <rect x="560" y="330" width="280" height="30" rx="15" />
        <rect x="470" y="392" width="370" height="30" rx="15" />
        <rect x="610" y="454" width="230" height="30" rx="15" />
      </g>
      <path d="M90 930C230 770 390 650 860 610" stroke="#0b0b0b" strokeWidth="150" />
      <path
        className="rd-road-dash"
        d="M90 930C230 770 390 650 860 610"
        stroke="#ffd400"
        strokeWidth="12"
        strokeDasharray="52 32"
      />
    </svg>
  )
}

export default function Hero({ settings }) {
  return (
    <section className="relative overflow-hidden bg-[var(--rd-yellow)]">
      <div className="relative z-10 mx-auto max-w-[90rem] px-4 pb-10 pt-12 sm:px-8 sm:pt-16 lg:min-h-[43rem] lg:pb-20">
        <h1 className="rd-display rd-hero-title">
          Get there.
          <br />
          Get fed.
        </h1>

        <p className="mt-8 max-w-md text-xl font-medium leading-snug">
          Cabs, bikes and autos when you need to move. Food from the places nearby when you would rather stay put. One
          app for both.
        </p>

        <div className="mt-9 flex flex-col gap-4 sm:flex-row">
          <a href="/taxi/user" className="rd-btn rd-btn-black">
            <span>Book a ride</span> <ArrowRight className="h-5 w-5" />
          </a>
          <a href="/food/user" className="rd-btn rd-btn-line">
            <span>Order food</span> <ArrowRight className="h-5 w-5" />
          </a>
        </div>

        <StoreBadges settings={settings} className="mt-8" />
      </div>

      <RoadArt className="block h-56 w-full sm:h-72 lg:absolute lg:bottom-0 lg:right-0 lg:h-[88%] lg:w-[56%]" />
    </section>
  )
}
