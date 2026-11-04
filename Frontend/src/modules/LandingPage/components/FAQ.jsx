import { useState } from 'react'
import { Plus } from 'lucide-react'

const DEFAULT_FAQS = [
  {
    question: 'What can I do with Raydo?',
    answer: 'Book cabs, bikes, autos, parcels, airport trips and rentals, and order food from restaurants near you. It is all one app.',
  },
  {
    question: 'How do I pay?',
    answer: 'UPI, cards, wallet or cash. You see the fare or the bill before you confirm.',
  },
  {
    question: 'How do I become a driver?',
    answer: 'Tap "Register as a driver", fill in your details and upload your licence and vehicle documents. Once they are verified you can start taking trips.',
  },
  {
    question: 'How can my restaurant join?',
    answer: 'Tap "List your restaurant" and sign in with your phone number to set up your restaurant, menu and payout details.',
  },
  {
    question: 'Is my ride safe?',
    answer: 'Drivers are verified, you can share your trip live with family, and SOS is available from inside the ride.',
  },
]

export default function FAQ({ settings }) {
  const faqs = settings?.faqs?.length ? settings.faqs : DEFAULT_FAQS
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" className="scroll-mt-[4.5rem] bg-[var(--rd-paper)] py-20 lg:py-28">
      <div className="mx-auto grid max-w-[90rem] gap-12 px-4 sm:px-8 lg:grid-cols-2">
        <h2 className="rd-display rd-section-title">Before you ask.</h2>

        <div className="border-t-[3px] border-[var(--rd-black)]">
          {faqs.map((faq, i) => {
            const isOpen = open === i
            return (
              <div key={i} className="border-b-[3px] border-[var(--rd-black)]">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left text-xl font-bold"
                >
                  {faq.question}
                  <Plus className={`h-7 w-7 shrink-0 transition-transform ${isOpen ? 'rotate-45' : ''}`} />
                </button>
                {isOpen && <p className="max-w-xl pb-6 text-lg leading-relaxed text-[var(--rd-muted)]">{faq.answer}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
