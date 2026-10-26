import type { ReactNode } from 'react'

/** The status bar shown at the top of every phone screen: the time, signal and battery. Drawn, not an image, so it stays sharp. */
function StatusBar({ dark = false, time = '9:41' }: { dark?: boolean; time?: string }) {
  return (
    <div className={`absolute inset-x-0 top-0 z-10 flex h-8 items-end justify-between px-5 pb-0.5 text-[10px] font-semibold ${dark ? 'text-white' : 'text-ink'}`} aria-hidden>
      <span>{time}</span>
      <span className="flex items-center gap-1">
        <svg viewBox="0 0 16 10" className="h-2.5 w-4" fill="currentColor"><rect x="0" y="6" width="3" height="4" rx="0.6" /><rect x="4.4" y="4" width="3" height="6" rx="0.6" /><rect x="8.8" y="2" width="3" height="8" rx="0.6" /><rect x="13.2" y="0" width="2.8" height="10" rx="0.6" /></svg>
        <svg viewBox="0 0 24 11" className="h-2.5 w-5" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="currentColor" opacity="0.5" /><rect x="2" y="2" width="14" height="7" rx="1.8" fill="currentColor" /><rect x="21.5" y="3.5" width="2" height="4" rx="1" fill="currentColor" opacity="0.5" /></svg>
      </span>
    </div>
  )
}

/** An iPhone-style device: rounded body, the notch island, and the home bar. The screen content is whatever you put inside. */
export function IPhone({ children, className = '', label = 'App screen on an iPhone' }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div role="img" aria-label={label} className={`relative aspect-[9/19.3] w-[15.5rem] rounded-[2.7rem] bg-[#10192b] p-[7px] shadow-[0_30px_60px_-20px_rgb(3_4_94/0.55),0_0_0_1.5px_rgb(255_255_255/0.08)_inset] ring-1 ring-black/30 ${className}`}>
      <span aria-hidden className="absolute -left-[2px] top-24 h-8 w-[3px] rounded-l bg-[#10192b]" /><span aria-hidden className="absolute -left-[2px] top-36 h-12 w-[3px] rounded-l bg-[#10192b]" /><span aria-hidden className="absolute -right-[2px] top-32 h-16 w-[3px] rounded-r bg-[#10192b]" />
      <div className="relative size-full overflow-hidden rounded-[2.2rem] bg-white">
        <StatusBar />
        <span aria-hidden className="absolute left-1/2 top-2 z-20 h-[1.35rem] w-[5.2rem] -translate-x-1/2 rounded-full bg-black" />
        {children}
        <span aria-hidden className="absolute bottom-1.5 left-1/2 z-20 h-1 w-24 -translate-x-1/2 rounded-full bg-ink/80" />
      </div>
    </div>
  )
}

/** An Android-style device: slimmer corners, a punch-hole camera and the gesture bar. */
export function AndroidPhone({ children, className = '', label = 'App screen on an Android phone' }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div role="img" aria-label={label} className={`relative aspect-[9/19.8] w-[15rem] rounded-[2rem] bg-[#1b2434] p-[6px] shadow-[0_30px_60px_-20px_rgb(3_4_94/0.5),0_0_0_1.5px_rgb(255_255_255/0.06)_inset] ring-1 ring-black/30 ${className}`}>
      <span aria-hidden className="absolute -right-[2px] top-24 h-10 w-[3px] rounded-r bg-[#1b2434]" /><span aria-hidden className="absolute -right-[2px] top-40 h-16 w-[3px] rounded-r bg-[#1b2434]" />
      <div className="relative size-full overflow-hidden rounded-[1.6rem] bg-white">
        <StatusBar time="10:09" />
        <span aria-hidden className="absolute left-1/2 top-2.5 z-20 size-2.5 -translate-x-1/2 rounded-full bg-black" />
        {children}
        <span aria-hidden className="absolute bottom-1.5 left-1/2 z-20 h-[3px] w-16 -translate-x-1/2 rounded-full bg-ink/70" />
      </div>
    </div>
  )
}
