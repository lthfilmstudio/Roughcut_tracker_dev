import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 共用 supabase-js client singleton
// 所有需要 Supabase 的元件（SupabaseService、SupabasePreview 等）共用，避免多實例警告

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 沒設定')
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  }
  return _client
}

export function hasSupabaseConfig(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}
