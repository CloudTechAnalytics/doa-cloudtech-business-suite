export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
}

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)

/**
 * Demo mode runs a browser-only fake backend with sample data. It exists for local development and the automated tests only, and is never
 * active in a production build: a production site without Supabase settings shows a setup message instead of pretending to work.
 */
export const isDemoMode = !isBackendConfigured && import.meta.env.DEV

/** A production build with no Supabase settings. */
export const isMisconfigured = !isBackendConfigured && !import.meta.env.DEV
