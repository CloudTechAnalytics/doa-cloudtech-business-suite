import { Download, Smartphone } from 'lucide-react'

function Store({ top, name, icon, dark }: { top: string; name: string; icon: React.ReactNode; dark: boolean }) {
  return (
    <div role="img" aria-label={`${name}: coming soon`} className={`relative flex h-14 min-w-[10.5rem] items-center gap-3 rounded-xl px-4 ring-1 ${dark ? 'bg-white/10 text-white ring-white/25' : 'bg-ink text-white ring-ink'}`}>
      <span className="shrink-0">{icon}</span>
      <span className="leading-tight"><span className="block text-[10px] font-medium uppercase tracking-wide text-white/70">{top}</span><span className="block text-[17px] font-bold">{name}</span></span>
      <span className="absolute -right-2 -top-2.5 rounded-full bg-amber px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-ink shadow-card">Soon</span>
    </div>
  )
}

/** "Get it on Google Play" and "App Store" badges marked Soon. The apps are not in the stores yet; the site installs to the home screen today. */
export function StoreBadges({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Store dark={dark} top="Get it on" name="Google Play" icon={<svg viewBox="0 0 24 24" className="size-7" aria-hidden><path d="M3.5 2.2v19.6c0 .5.55.8.98.52L20.6 12.5a.6.6 0 0 0 0-1.03L4.48 1.7a.6.6 0 0 0-.98.5Z" fill="url(#gp)" /><defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#00e0a4" /><stop offset=".5" stopColor="#00a6ff" /><stop offset="1" stopColor="#ff4f5e" /></linearGradient></defs></svg>} />
      <Store dark={dark} top="Download on the" name="App Store" icon={<Smartphone className="size-7" aria-hidden />} />
    </div>
  )
}

export const InstallNote = () => <span className="inline-flex items-center gap-1.5"><Download className="size-3.5" aria-hidden /> Installs from your browser today</span>
