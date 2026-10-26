import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Prints designed documents (report cards, receipts) and nothing else from the screen. The sheets are drawn into a temporary #print-root that only exists
 * while printing; the print styles hide the rest of the page while it is there, so every other page that simply prints itself is unaffected. The root is
 * removed again when the print dialog closes.
 */
export function printSheets(sheets: ReactNode) {
  document.getElementById('print-root')?.remove()
  const host = document.createElement('div')
  host.id = 'print-root'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<>{sheets}</>)
  const cleanup = () => { window.removeEventListener('afterprint', cleanup); root.unmount(); host.remove() }
  window.addEventListener('afterprint', cleanup)
  // Let React draw the sheets before the print dialog opens.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
}
