import { Download, Share, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components'

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const KEY = 'doa.install.dismissed'
const DAYS = 30
const recentlyDismissed = () => { try { const t = Number(localStorage.getItem(KEY)); return !!t && Date.now() - t < DAYS * 86_400_000 } catch { return false } }
const remember = () => { try { localStorage.setItem(KEY, String(Date.now())) } catch { /* storage unavailable */ } }
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const isIosSafari = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent)

/**
 * Offers to install the app on the phone: the browser's own install prompt where it exists (Android, desktop Chrome and Edge), and a short how-to on iPhone, where
 * the browser has no such prompt. It stays out of the way once the app is installed, and after being dismissed it does not come back for a month.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [hidden, setHidden] = useState(() => recentlyDismissed() || standalone())

  useEffect(() => {
    if (hidden) return
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent) }
    const onInstalled = () => { setEvent(null); setHidden(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    if (isIosSafari()) setIos(true)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [hidden])

  if (hidden || (!event && !ios)) return null
  const dismiss = () => { remember(); setHidden(true) }
  return (
    <div role="dialog" aria-label="Install the app" className="no-print fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-card sm:left-auto sm:right-4 sm:mx-0">
      <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Install DOA on your phone</p>
        {event ? <p className="text-xs text-ink/70">Open it from your home screen, full screen, like any other app.</p>
          : <p className="text-xs text-ink/70">Tap <Share className="inline size-3.5 align-text-bottom" aria-hidden /> Share, then <b>Add to Home Screen</b>.</p>}
      </div>
      {event && <Button onClick={() => void event.prompt().then(() => event.userChoice).then((c) => { setEvent(null); if (c.outcome === 'dismissed') dismiss(); else setHidden(true) })}><Download className="size-4" aria-hidden /> Install</Button>}
      <button type="button" onClick={dismiss} aria-label="Not now" className="grid size-8 shrink-0 place-items-center rounded-md text-ink/60 hover:bg-surface"><X className="size-4" aria-hidden /></button>
    </div>
  )
}

/** A thin bar while the phone has no connection, so a failed save is never a mystery. */
export function OfflineBar() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return <div role="status" className="no-print fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-ink px-3 py-1.5 text-xs font-medium text-white"><WifiOff className="size-3.5" aria-hidden /> You are offline. Changes cannot be saved until you are back online.</div>
}
