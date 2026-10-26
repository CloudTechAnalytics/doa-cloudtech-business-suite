import { useEffect, useState } from 'react'
import { LogoLetters } from './Brand'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** While the opening screen is up, page animations wait so the landing page plays from the start once it lifts. */
const hold = (on: boolean) => document.documentElement.classList.toggle('splash-on', on)

/**
 * Opening screen: the two halves of the mark slide together while a 0 to 100 counter fills a bar, then the screen lifts away.
 * It plays every time the landing page is loaded or refreshed (not when moving around inside the site), and the count waits at 99 until the page has really finished loading.
 */
export function Splash() {
  const [show, setShow] = useState(() => { const s = location.pathname === '/' && !reduced(); hold(s); return s })
  const [pct, setPct] = useState(0)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!show) return
    document.body.style.overflow = 'hidden'; hold(true)
    const t0 = performance.now(); let raf = 0; let loaded = document.readyState === 'complete'
    const onLoad = () => { loaded = true }
    window.addEventListener('load', onLoad)
    const timers: number[] = []
    const tick = (now: number) => {
      const p = Math.min((now - t0) / 1900, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = Math.min(Math.round(eased * 100), loaded ? 100 : 99)
      setPct(v)
      if (v < 100) raf = requestAnimationFrame(tick)
      else {
        timers.push(window.setTimeout(() => { setLeaving(true); hold(false) }, 250), window.setTimeout(() => { setShow(false); hold(false); document.body.style.overflow = '' }, 1050))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); hold(false); window.removeEventListener('load', onLoad); document.body.style.overflow = '' }
  }, [show])

  if (!show) return null
  return (
    <div role="status" aria-label={`Loading ${pct} percent`} className={`splash fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand text-white ${leaving ? 'splash-out' : ''}`}>
      <svg viewBox="0 0 110 48" className="h-20 w-auto" aria-hidden>
        <LogoLetters teal="#ffffff" className={{ d: 'splash-d', o: 'splash-o', a: 'splash-a' }} />
      </svg>
      <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} /></div>
      <p className="tabular mt-3 text-sm font-semibold text-white/70">{pct}%</p>
    </div>
  )
}
