/**
 * Colour themes. The website and every new business start on Ocean (the DOA palette). A business owner can pick another one in Settings, and
 * it then colours that business's whole workspace: the sidebar, buttons, highlights and links. Only these named choices are accepted, never a free colour.
 */
export interface Theme {
  key: string
  name: string
  /** Dark chrome: sidebar and dark panels. */
  brand: string
  brandDark: string
  /** Links, focus rings and active states. */
  accent: string
  accentSoft: string
  /** The main button and highlight colour (dark text sits on it). */
  cta: string
  ctaDark: string
  /** A lighter companion for small accents. */
  soft: string
}

export const THEMES: Theme[] = [
  { key: 'ocean', name: 'Ocean', brand: '#03045e', brandDark: '#023e8a', accent: '#0077b6', accentSoft: '#caf0f8', cta: '#00b4d8', ctaDark: '#0096c7', soft: '#48cae4' },
  { key: 'teal', name: 'Teal', brand: '#042f35', brandDark: '#0b4f5c', accent: '#0f766e', accentSoft: '#ccfbf1', cta: '#2dd4bf', ctaDark: '#14b8a6', soft: '#5eead4' },
  { key: 'emerald', name: 'Emerald', brand: '#052e1c', brandDark: '#14532d', accent: '#15803d', accentSoft: '#dcfce7', cta: '#4ade80', ctaDark: '#22c55e', soft: '#86efac' },
  { key: 'violet', name: 'Violet', brand: '#2e1065', brandDark: '#4c1d95', accent: '#6d28d9', accentSoft: '#ede9fe', cta: '#a78bfa', ctaDark: '#8b5cf6', soft: '#c4b5fd' },
  { key: 'sunset', name: 'Sunset', brand: '#431407', brandDark: '#7c2d12', accent: '#c2410c', accentSoft: '#ffedd5', cta: '#fb923c', ctaDark: '#f97316', soft: '#fdba74' },
  { key: 'rose', name: 'Rose', brand: '#4c0519', brandDark: '#881337', accent: '#be123c', accentSoft: '#ffe4e6', cta: '#fb7185', ctaDark: '#f43f5e', soft: '#fda4af' },
  { key: 'slate', name: 'Slate', brand: '#0f172a', brandDark: '#1e293b', accent: '#334155', accentSoft: '#e2e8f0', cta: '#94a3b8', ctaDark: '#64748b', soft: '#cbd5e1' },
]

export const DEFAULT_THEME = THEMES[0]
export const themeByKey = (key: string | null | undefined): Theme => THEMES.find((t) => t.key === key) ?? DEFAULT_THEME

const VARS: [string, (t: Theme) => string][] = [
  ['--color-brand', (t) => t.brand], ['--color-brand-dark', (t) => t.brandDark], ['--color-brand-ink', (t) => t.brandDark],
  ['--color-accent', (t) => t.accent], ['--color-accent-soft', (t) => t.accentSoft],
  ['--color-amber', (t) => t.cta], ['--color-amber-dark', (t) => t.ctaDark], ['--color-mint', (t) => t.soft],
]

/** Paints a theme over the whole page (it overrides the defaults in index.css). Returns a function that puts the defaults back. */
export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement
  for (const [name, pick] of VARS) root.style.setProperty(name, pick(theme))
  return () => { for (const [name] of VARS) root.style.removeProperty(name) }
}
