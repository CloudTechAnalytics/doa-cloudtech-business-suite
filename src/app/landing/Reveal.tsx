import { createElement, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/** Eases its content in once, the first time it scrolls into view. Without IntersectionObserver it is simply shown. */
export function Reveal({ children, delay = 0, as = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'li' | 'section' | 'ul' | 'dl'; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return createElement(as, { ref, className: `reveal ${shown ? 'in' : ''} ${className}`, style: { '--d': `${delay}ms` } as CSSProperties }, children)
}
