import { BrandLockup } from './Brand'

/** Shown by a production build that has no Supabase settings, instead of any pretend data. */
export function SetupMissing() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="max-w-md rounded-xl bg-white p-8 text-center shadow-card">
        <div className="flex justify-center"><BrandLockup /></div>
        <h1 className="mt-6 text-xl font-bold">This site is not connected yet</h1>
        <p className="mt-2 text-sm text-ink/70">The database settings (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>) are missing from this deployment. Add them in the hosting settings and redeploy.</p>
      </div>
    </main>
  )
}
