export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
}

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)

/** Demo mode runs a browser-only fake backend. Active only when Supabase is not configured. */
export const isDemoMode = !isBackendConfigured
