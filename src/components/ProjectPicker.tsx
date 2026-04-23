import { useEffect, useState } from 'react'
import { getDataService } from '../services'
import type { ProjectConfig } from '../config/projectConfig'

interface Props {
  userEmail: string | null
  onPick: (project: ProjectConfig) => void
  onLogout: () => void
}

export default function ProjectPicker({ userEmail, onPick, onLogout }: Props) {
  const [projects, setProjects] = useState<ProjectConfig[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const svc = getDataService()
    svc.getProjects()
      .then(setProjects)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // 自動跳轉：只有一個專案時直接進去
  useEffect(() => {
    if (projects && projects.length === 1) {
      onPick(projects[0])
    }
  }, [projects, onPick])

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <div style={s.header}>
          <p style={s.label}>Roughcut Tracker</p>
          <button type="button" onClick={onLogout} style={s.logoutBtn}>登出</button>
        </div>
        <h1 style={s.title}>選擇專案</h1>
        <p style={s.userInfo}>已登入：{userEmail || '（未知使用者）'}</p>

        {projects === null && !error && (
          <p style={s.loading}>讀取中⋯</p>
        )}

        {error && (
          <p style={s.error}>讀取失敗：{error}</p>
        )}

        {projects && projects.length === 0 && (
          <div style={s.emptyBox}>
            <p style={{ margin: 0, fontWeight: 600 }}>你沒有任何專案權限</p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              請聯絡管理者，把你加到 project_members 表裡，或設為 super_admin。
            </p>
          </div>
        )}

        {projects && projects.length > 0 && (
          <ul style={s.list}>
            {projects.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p)} style={s.projectBtn}>
                  <span style={s.projectName}>{p.name}</span>
                  <span style={s.projectMeta}>
                    {p.type === 'series' ? `劇集 · ${p.episodeCount ?? '?'} 集` : '電影'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--bg)',
  },
  card: {
    width: 420, padding: '32px 32px 28px', background: 'var(--card-bg)',
    borderRadius: 12, border: '1px solid var(--border)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 11, color: 'var(--text-secondary)', margin: 0,
    letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  logoutBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 6, fontSize: 12,
    padding: '4px 10px', cursor: 'pointer',
  },
  title: { fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: '8px 0 4px' },
  userInfo: { fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 20px' },
  loading: { fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0' },
  error: { fontSize: 13, color: 'var(--color-missing)', textAlign: 'center', padding: '12px 0' },
  emptyBox: {
    padding: 16, borderRadius: 8, border: '1px dashed var(--border)',
    color: 'var(--text-primary)',
  },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  projectBtn: {
    width: '100%', padding: '14px 16px',
    background: '#111', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8,
    cursor: 'pointer', textAlign: 'left',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  projectName: { fontWeight: 600, fontSize: 15 },
  projectMeta: { fontSize: 12, color: 'var(--text-secondary)' },
}
