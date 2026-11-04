import { ArrowRight } from 'lucide-react'

export default function Partners() {
  return (
    <section id="partners" className="grid scroll-mt-[4.5rem] md:grid-cols-2">
      <div className="bg-[var(--rd-yellow)] px-4 py-16 sm:px-8 lg:py-24 xl:pl-[max(2rem,calc((100vw-90rem)/2+2rem))]">
        <h2 className="rd-display rd-section-title">
          Got a vehicle?
          <br />
          Drive with us.
        </h2>
        <p className="mt-6 max-w-md text-xl font-medium leading-snug">
          Your vehicle, your hours. Upload your licence and documents, get verified, and start taking trips.
        </p>
        <a href="/taxi/driver" className="rd-btn rd-btn-black mt-9">
          <span>Register as a driver</span> <ArrowRight className="h-5 w-5" />
        </a>
      </div>

      <div className="bg-[#1b1b1b] px-4 py-16 text-white sm:px-8 lg:py-24">
        <h2 className="rd-display rd-section-title">
          Got a kitchen?
          <br />
          Sell with us.
        </h2>
        <p className="mt-6 max-w-md text-xl font-medium leading-snug text-white/80">
          Put your menu in front of people nearby, and run orders, menus and payouts from one dashboard.
        </p>
        <a href="/food/restaurant/login" className="rd-btn rd-btn-yellow mt-9">
          <span>List your restaurant</span> <ArrowRight className="h-5 w-5" />
        </a>
      </div>
    </section>
  )
}
