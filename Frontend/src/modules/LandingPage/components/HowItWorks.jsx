const STOPS = [
  { title: 'Sign in with your phone', body: 'One OTP and you are in. No password to remember.' },
  { title: 'Pick a ride or a restaurant', body: 'Set your pickup and drop, or fill your cart. You see the price before you confirm.' },
  { title: 'Follow it on the map', body: 'Your driver or delivery rider, live, until you have arrived or dinner has.' },
]

const PROMISES = [
  { title: 'Verified drivers', body: 'Share your trip with family, and reach SOS from inside the ride.' },
  { title: 'Pay your way', body: 'UPI, cards, wallet or cash.' },
  { title: 'Help in the app', body: 'Raise it from the app when something goes wrong.' },
]

export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-[4.5rem] bg-[var(--rd-paper)] py-20 lg:py-28">
      <div className="mx-auto grid max-w-[90rem] gap-14 px-4 sm:px-8 lg:grid-cols-2">
        <h2 className="rd-display rd-section-title">
          Three stops.
          <br />
          That is the trip.
        </h2>

        <ol className="rd-stops ml-6 space-y-12 pb-1">
          {STOPS.map(({ title, body }, i) => (
            <li key={title} className="relative pl-12">
              <span className="rd-stop-number rd-display">{i + 1}</span>
              <h3 className="text-2xl font-bold">{title}</h3>
              <p className="mt-2 max-w-md text-lg text-[var(--rd-muted)]">{body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mx-auto mt-20 max-w-[90rem] px-4 sm:px-8">
        <dl className="grid gap-8 border-t-[3px] border-[var(--rd-black)] pt-8 md:grid-cols-3">
          {PROMISES.map(({ title, body }) => (
            <div key={title}>
              <dt className="text-xl font-bold">{title}</dt>
              <dd className="mt-1 max-w-xs text-[var(--rd-muted)]">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
