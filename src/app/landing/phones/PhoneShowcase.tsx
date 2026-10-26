import { Check, ReceiptText, TriangleAlert } from 'lucide-react'
import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { AndroidPhone, IPhone } from './PhoneFrame'
import { ScreenStack } from './ScreenStack'
import { useCycle, useScrollProgress } from './hooks'

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
const HERO_SCREENS = ['sales', 'school', 'farm', 'dashboard', 'bakery', 'pharmacy']

function Chip({ className, delay, icon, children }: { className: string; delay: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`anim-pop absolute z-30 ${className}`} style={d(900 + delay)}>
      <div className="anim-float flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3.5 text-xs font-bold text-ink shadow-raised ring-1 ring-ink/10" style={d(delay)}>{icon}{children}</div>
    </div>
  )
}

/**
 * The hero's pair of phones, an iPhone and an Android side by side and overlapping. Both show the app and change screen on their own, one a little behind the other;
 * as the page scrolls they drift apart and straighten, and small chips ("₦96,700 paid") float around them.
 */
export function PhoneShowcase() {
  const ref = useRef<HTMLDivElement>(null)
  useScrollProgress(ref)
  const [i] = useCycle(HERO_SCREENS.length, 3600, ref)
  return (
    <div ref={ref} className="relative mx-auto h-[33rem] w-full max-w-[33rem] max-sm:-mb-14 max-sm:h-[28rem] max-sm:origin-top max-sm:scale-[0.82]" aria-label="DOA running on an iPhone and an Android phone">
      <div aria-hidden className="absolute left-1/2 top-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber/40 via-mint/30 to-accent/20 blur-3xl" />
      <div className="absolute bottom-2 left-[3%] will-change-transform max-sm:left-[-4%]" style={{ transform: 'translateY(calc(var(--p, 0) * 38px)) rotate(calc(-8deg + var(--p, 0) * 6deg))' }}>
        <div className="anim-pop" style={d(500)}><div className="anim-float" style={d(600)}><AndroidPhone><ScreenStack ids={HERO_SCREENS} active={(i + 3) % HERO_SCREENS.length} /></AndroidPhone></div></div>
      </div>
      <div className="absolute right-[2%] top-0 will-change-transform max-sm:right-[-2%]" style={{ transform: 'translateY(calc(var(--p, 0) * -46px)) rotate(calc(6deg - var(--p, 0) * 5deg))' }}>
        <div className="anim-pop" style={d(300)}><div className="anim-float"><IPhone><ScreenStack ids={HERO_SCREENS} active={i} /></IPhone></div></div>
      </div>
      <Chip className="left-[-1%] top-[14%] max-sm:hidden" delay={0} icon={<span className="grid size-6 place-items-center rounded-full bg-success text-white"><Check className="size-3.5" aria-hidden /></span>}>₦96,700 paid</Chip>
      <Chip className="right-[-2%] top-[52%] max-sm:right-0" delay={900} icon={<span className="grid size-6 place-items-center rounded-full bg-amber text-ink"><TriangleAlert className="size-3.5" aria-hidden /></span>}>3 items low</Chip>
      <Chip className="bottom-[7%] right-[8%] max-sm:hidden" delay={1700} icon={<span className="grid size-6 place-items-center rounded-full bg-brand text-white"><ReceiptText className="size-3.5" aria-hidden /></span>}>Receipt sent</Chip>
    </div>
  )
}
