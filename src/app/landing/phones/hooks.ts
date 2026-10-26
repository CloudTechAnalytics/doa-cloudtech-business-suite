import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** True when the visitor has asked their device for less motion; the landing page then shows still screens and skips parallax. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!q) return
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}

/** 0, 1, 2 ... count-1 and round again every `ms`; stops while the tab is hidden, the element is off screen, or motion is reduced. */
export function useCycle(count: number, ms: number, el?: RefObject<HTMLElement | null>) {
  const [i, setI] = useState(0)
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const node = el?.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 })
    io.observe(node)
    return () => io.disconnect()
  }, [el])
  useEffect(() => {
    if (reduced || !visible || count < 2) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') setI((v) => (v + 1) % count) }, ms)
    return () => clearInterval(t)
  }, [count, ms, reduced, visible])
  return [i, setI] as const
}

/** Writes how far the page has scrolled (0 at the top, 1 after `range` pixels) into a CSS variable `--p` on the element, so phones can drift as you scroll. */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, range = 700) {
  const reduced = useReducedMotion()
  const frame = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const update = () => { frame.current = 0; el.style.setProperty('--p', String(Math.min(1, Math.max(0, window.scrollY / range)))) }
    const onScroll = () => { if (!frame.current) frame.current = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (frame.current) cancelAnimationFrame(frame.current) }
  }, [ref, range, reduced])
}
