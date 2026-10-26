import { Globe, Share2 } from 'lucide-react'
import { useRef } from 'react'
import { AndroidPhone, IPhone } from './phones/PhoneFrame'
import { ScreenStack } from './phones/ScreenStack'
import { useCycle } from './phones/hooks'
import { Reveal } from './Reveal'
import { InstallNote, StoreBadges } from './StoreBadges'

const A = ['school', 'sales', 'farm']
const B = ['receipt', 'dashboard', 'pharmacy']

/** The mobile section: two phones that rise and settle against each other while their screens change together, the store badges marked Soon, and how to install today. */
export function MobileApps() {
  const ref = useRef<HTMLDivElement>(null)
  const [i] = useCycle(A.length, 4200, ref)
  return (
    <section id="mobile" className="mt-24 scroll-mt-24">
      <div ref={ref} className="anim-gradient relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-[#0f3a66] to-brand px-6 py-14 text-white sm:px-12 lg:py-16">
        <span aria-hidden className="absolute -right-10 -top-16 size-64 rounded-full bg-mint/25 blur-3xl" />
        <span aria-hidden className="absolute -bottom-20 left-10 size-64 rounded-full bg-[#fbb130]/20 blur-3xl" />
        <div className="relative grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber ring-1 ring-white/20">Mobile apps</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">DOA, <span className="text-amber">in your pocket</span></h2>
            <p className="mt-4 max-w-md text-lg text-white/80">Make the sale at the market stall, mark the register at the school gate, check the pen from the farm road. Native Android and iPhone apps are on the way.</p>
            <div className="mt-7"><StoreBadges dark /></div>
            <p className="mt-4 text-sm font-semibold text-white/80"><InstallNote /> and works the same.</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              <li className="rounded-xl bg-white/10 p-4 ring-1 ring-white/15"><p className="flex items-center gap-2 text-sm font-bold"><Globe className="size-4 text-amber" aria-hidden /> Android</p><p className="mt-1 text-sm text-white/75">Open DOA in Chrome, then menu, then <b>Install app</b>.</p></li>
              <li className="rounded-xl bg-white/10 p-4 ring-1 ring-white/15"><p className="flex items-center gap-2 text-sm font-bold"><Share2 className="size-4 text-amber" aria-hidden /> iPhone</p><p className="mt-1 text-sm text-white/75">Open DOA in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p></li>
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <div className="relative mx-auto h-[31rem] w-full max-w-[30rem] max-sm:-mb-12 max-sm:h-[27rem] max-sm:origin-top max-sm:scale-[0.84]">
              <div className="absolute left-[2%] top-12 max-sm:left-[-3%]" style={{ transform: 'rotate(-6deg)' }}><div className="phone-rise-a"><AndroidPhone><ScreenStack ids={A} active={i} /></AndroidPhone></div></div>
              <div className="absolute right-[2%] top-0 max-sm:right-[-3%]" style={{ transform: 'rotate(5deg)' }}><div className="phone-rise-b"><IPhone><ScreenStack ids={B} active={i} /></IPhone></div></div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
