import { useEffect, useMemo, useState } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

// ====================================================
// Supabase Preview
// 用來驗證 Supabase 端的資料、Auth、RLS 是否可用。
// 獨立於主 app 的 login/auth 流程。
// 進入方式：網址後面加 #supabase-preview
// ====================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Project = {
  id: string
  name: string
  type: 'series' | 'film'
  episode_count: number | null
  episode_prefix: string | null
}

type Episode = {
  id: string
  ep_key: string
  display_order: number
}

type Scene = {
  id: string
  scene_key: string
  roughcut_length_secs: number | null
  pages: number | null
  roughcut_date: string | null
  status: string | null
  missing_shots: boolean
  notes: string | null
  row_order: number
}

function secsToHMS(s: number | null): string {
  if (s == null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function SupabasePreview() {
  const client = useMemo<SupabaseClient>(
    () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce', // code 放 query string，hash 保留給我們的路由
      },
    }),
    [],
  )

  const [session, setSession] = useState<Session | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Track session + 清掉 PKCE 回傳留在 URL 的 ?code=...
  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setSession(data.session)
      // PKCE 會留 ?code=xxx&state=xxx 在 query string，session 建立後清掉
      if (window.location.search.includes('code=')) {
        history.replaceState(null, '', window.location.pathname + '#supabase-preview')
      }
    })
    const { data: sub } = client.auth.onAuthStateChange((_evt, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [client])

  // Load projects when authenticated
  useEffect(() => {
    if (!session) {
      setProjects(null)
      return
    }
    setLoading(true)
    setError(null)
    client
      .from('projects')
      .select('id, name, type, episode_count, episode_prefix')
      .order('name')
      .then(({ data, error }) => {
        setLoading(false)
        if (error) setError(`讀 projects 失敗：${error.message}`)
        else setProjects((data as Project[]) ?? [])
      })
  }, [client, session])

  // Load episodes when project selected
  useEffect(() => {
    if (!selectedProjectId) {
      setEpisodes(null)
      return
    }
    setLoading(true)
    setError(null)
    client
      .from('episodes')
      .select('id, ep_key, display_order')
      .eq('project_id', selectedProjectId)
      .order('display_order')
      .then(({ data, error }) => {
        setLoading(false)
        if (error) setError(`讀 episodes 失敗：${error.message}`)
        else setEpisodes((data as Episode[]) ?? [])
      })
  }, [client, selectedProjectId])

  // Load scenes when episode selected
  useEffect(() => {
    if (!selectedEpisodeId) {
      setScenes(null)
      return
    }
    setLoading(true)
    setError(null)
    client
      .from('scenes')
      .select('id, scene_key, roughcut_length_secs, pages, roughcut_date, status, missing_shots, notes, row_order')
      .eq('episode_id', selectedEpisodeId)
      .order('row_order')
      .then(({ data, error }) => {
        setLoading(false)
        if (error) setError(`讀 scenes 失敗：${error.message}`)
        else setScenes((data as Scene[]) ?? [])
      })
  }, [client, selectedEpisodeId])

  async function handleSignIn() {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (error) setError(`Google 登入失敗：${error.message}`)
  }

  async function handleSignOut() {
    setSelectedProjectId(null)
    setSelectedEpisodeId(null)
    await client.auth.signOut()
  }

  // ----- Render -----

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div style={containerStyle}>
        <h1>Supabase 未設定</h1>
        <p>請在 .env 加入 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={containerStyle}>
        <h1>Supabase Preview</h1>
        <p style={{ color: '#666' }}>
          驗證 Supabase 端資料的獨立頁面。登入後會看到你（super_admin）能讀的所有專案。
        </p>
        <button onClick={handleSignIn} style={primaryBtn}>
          使用 Google 登入（Supabase Auth）
        </button>
        {error && <p style={errorStyle}>{error}</p>}
        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #eee' }} />
        <p style={{ fontSize: 12, color: '#999' }}>
          回到主 app：移除網址後面的 #supabase-preview
        </p>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Supabase Preview</h1>
        <button onClick={handleSignOut} style={secondaryBtn}>登出</button>
      </div>
      <p style={{ color: '#666', fontSize: 14 }}>
        已登入：<b>{session.user.email}</b> · user_id: <code style={codeInline}>{session.user.id.slice(0, 8)}…</code>
      </p>
      {error && <p style={errorStyle}>{error}</p>}

      {/* Projects */}
      <section style={sectionStyle}>
        <h2>Projects</h2>
        {loading && !projects ? <p>讀取中⋯</p> : null}
        {projects && projects.length === 0 && (
          <p style={{ color: '#c00' }}>
            你看不到任何專案。可能是 RLS 擋下來：確認你是 super_admin，或 project_members 有對應的 row。
          </p>
        )}
        {projects && (
          <ul style={listStyle}>
            {projects.map(p => (
              <li key={p.id}>
                <button
                  onClick={() => { setSelectedProjectId(p.id); setSelectedEpisodeId(null) }}
                  style={selectedProjectId === p.id ? selectedBtn : linkBtn}
                >
                  {p.name} <span style={{ color: '#999', fontSize: 12 }}>({p.id}, {p.type})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Episodes */}
      {selectedProjectId && (
        <section style={sectionStyle}>
          <h2>Episodes</h2>
          {loading && !episodes ? <p>讀取中⋯</p> : null}
          {episodes && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {episodes.map(e => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEpisodeId(e.id)}
                  style={selectedEpisodeId === e.id ? selectedBtn : linkBtn}
                >
                  {e.ep_key}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Scenes */}
      {selectedEpisodeId && (
        <section style={sectionStyle}>
          <h2>Scenes</h2>
          {loading && !scenes ? <p>讀取中⋯</p> : null}
          {scenes && scenes.length === 0 && <p>（這集還沒有場次資料）</p>}
          {scenes && scenes.length > 0 && (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>場次</th>
                  <th style={thStyle}>初剪長度</th>
                  <th style={thStyle}>頁數</th>
                  <th style={thStyle}>日期</th>
                  <th style={thStyle}>狀態</th>
                  <th style={thStyle}>尚缺</th>
                  <th style={thStyle}>備註</th>
                </tr>
              </thead>
              <tbody>
                {scenes.map(s => (
                  <tr key={s.id} style={s.status === '整場刪除' ? { opacity: 0.4, textDecoration: 'line-through' } : undefined}>
                    <td style={tdStyle}>{s.row_order}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.scene_key}</td>
                    <td style={tdStyle}>{secsToHMS(s.roughcut_length_secs)}</td>
                    <td style={tdStyle}>{s.pages ?? '—'}</td>
                    <td style={tdStyle}>{s.roughcut_date ?? '—'}</td>
                    <td style={tdStyle}>{s.status ?? ''}</td>
                    <td style={tdStyle}>{s.missing_shots ? '⚠' : ''}</td>
                    <td style={{ ...tdStyle, color: '#666', fontSize: 12 }}>{s.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}

// ---- inline styles (獨立頁面、不動主 app CSS) ----

const containerStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '40px auto',
  padding: '0 20px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
}

const secondaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
}

const linkBtn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #e5e7eb',
  background: '#fafafa',
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'left',
}

const selectedBtn: React.CSSProperties = {
  ...linkBtn,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
}

const sectionStyle: React.CSSProperties = {
  marginTop: 24,
  paddingTop: 16,
  borderTop: '1px solid #eee',
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 6px',
  borderBottom: '2px solid #ddd',
  background: '#f9fafb',
}

const tdStyle: React.CSSProperties = {
  padding: '6px',
  borderBottom: '1px solid #f0f0f0',
  verticalAlign: 'top',
}

const errorStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  color: '#b91c1c',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 13,
}

const codeInline: React.CSSProperties = {
  background: '#f3f4f6',
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 12,
}
