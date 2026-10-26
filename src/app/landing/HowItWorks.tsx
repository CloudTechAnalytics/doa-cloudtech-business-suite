import { useEffect, useRef, useState } from 'react'
import { Mark } from './Mark'
import { IPhone } from './phones/PhoneFrame'
import { ScreenStack } from './phones/ScreenStack'
import { Reveal } from './Reveal'

const STEPS = [
  { n: '01', time: 'Monday 8:00', title: 'Pick your business', text: 'Choose a shop, farm, bakery, pharmacy or school. DOA sets up the right tools for it, so you start with the screens you need and nothing you do not.', screen: 'dashboard' },
  { n: '02', time: 'Monday 9:30', title: 'Add what you sell or teach', text: 'Products, batches, students or classes: type them in, or bring a spreadsheet. Your staff get their own logins and only see what their role allows.', screen: 'bakery' },
  { n: '03', time: 'Monday 10:15', title: 'Record in seconds', text: 'Ring up a sale, mark the register, log the eggs. Every entry is kept as a permanent record, and a mistake is corrected with a new entry, never erased.', screen: 'sales' },
  { n: '04', time: 'Friday 17:00', title: 'Get paid and see where you stand', text: 'Print receipts, send report cards, and check the week at a glance: what came in, what is owed and what is running low.', screen: 'receipt' },
] as const
const IDS = STEPS.map((s) => s.screen)

/** Four steps beside one phone that follows you down the page: as each step comes into view the phone moves to the matching screen. */
export function HowItWorks() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step)) }, { rootMargin: '-42% 0px -42% 0px' })
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])
  return (
    <section id="how" className="scroll-mt-24">
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">From sign-up to <Mark>first sale</Mark> in a morning</h2>
        <p className="mx-auto mt-4 max-w-xl text-base font-medium text-ink/80">Set up once, then run the day from your phone.</p>
      </Reveal>
      <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
        <ol className="space-y-5 lg:space-y-0">
          {STEPS.map((s, i) => (
            <li key={s.n} ref={(el) => { refs.current[i] = el }} data-step={i} className="lg:flex lg:min-h-[58vh] lg:items-center">
              <Reveal className={`w-full rounded-2xl bg-white p-6 shadow-card ring-1 transition duration-500 lg:p-8 ${active === i ? 'ring-amber lg:scale-[1.02] lg:shadow-raised' : 'ring-ink/10 lg:opacity-60'}`}>
                <div className="flex items-center justify-between"><span className="text-4xl font-black text-amber">{s.n}</span><span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-ink/60">{s.time}</span></div>
                <h3 className="mt-3 text-2xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-base text-ink/70">{s.text}</p>
              </Reveal>
            </li>
          ))}
        </ol>
        <div className="hidden lg:sticky lg:top-24 lg:block">
          <div className="relative mx-auto w-fit">
            <div aria-hidden className="absolute left-1/2 top-1/2 size-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-mint/35 via-amber/25 to-accent/20 blur-3xl" />
            <div className="relative"><IPhone label={`Step ${active + 1}: ${STEPS[active].title}`}><ScreenStack ids={[...IDS]} active={active} /></IPhone></div>
            <div className="absolute -left-14 top-16 rounded-full bg-ink px-3.5 py-1.5 text-xs font-bold text-white shadow-raised transition-all duration-500" key={active}>{STEPS[active].time}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
