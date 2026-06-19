import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, hasSupabaseConfig } from '../services/supabaseClient'
import type { AuthState } from '../types'

export interface AuthAPI extends AuthState {
  userEmail: string | null
  userId: string | null
  login: () => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): AuthAPI {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(() => !hasSupabaseConfig())

  useEffect(() => {
    if (!hasSupabaseConfig()) return
    const client = getSupabaseClient()

    // 初次讀 session（可能是 PKCE 剛換完 code 回來）
    client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
      // 清掉 URL 上的 PKCE ?code=xxx&state=xxx
      if (window.location.search.includes('code=')) {
        const clean = window.location.pathname + window.location.hash
        history.replaceState(null, '', clean)
      }
    })

    const { data: sub } = client.auth.onAuthStateChange((_evt, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  async function login() {
    const client = getSupabaseClient()
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (error) console.error('Google 登入失敗：', error.message)
  }

  async function logout() {
    await getSupabaseClient().auth.signOut()
  }

  return {
    accessToken: session?.access_token ?? null,
    isAuthenticated: ready && !!session,
    userEmail: session?.user?.email ?? null,
    userId: session?.user?.id ?? null,
    login,
    logout,
  }
}
