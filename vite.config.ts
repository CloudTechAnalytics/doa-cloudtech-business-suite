import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Each DB test file boots its own in-process PostgreSQL and applies every migration; allow for slow machines.
  // The tests run against the browser demo and an in-process database, never the real Supabase project in .env.local.
  test: { testTimeout: 30_000, hookTimeout: 90_000, env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
