import { createClient } from '@supabase/supabase-js'
import { env, isBackendConfigured } from '@/shared/utilities/env'

// Only the anon key is ever used in the browser; access is enforced by RLS.
export const supabase = isBackendConfigured ? createClient(env.supabaseUrl, env.supabaseAnonKey) : null
