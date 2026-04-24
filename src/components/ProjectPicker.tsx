import { useEffect, useState } from 'react'
import { getDataService } from '../services'
import type { ProjectConfig, ProjectType } from '../config/projectConfig'

interface Props {
  userEmail: string | null
  onPick: (project: ProjectConfig) => void
  onLogout: () => void
}

export default function ProjectPicker({ userEmail, onPick, onLogout }: Props) {
  const [projects, setProjects] = useState<ProjectConfig[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const refresh = async () => {
    const svc = getDataService()
    try {
      const list = await svc.getProjects()
      setProjects(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    refresh()
    getDataService().isSuperAdmin().then(setIsSuperAdmin).catch(() => setIsSuperAdmin(false))
  }, [])

  // 自動跳轉：只有一個專案時直接進去（super_admin 要能開表單，所以拔掉自動跳）
  useEffect(() => {
    if (projects && projects.length === 1 && !isSuperAdmin) {
      onPick(projects[0])
    }
  }, [projects, onPick, isSuperAdmin])

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <div style={s.header}>
          <p style={s.label}>Roughcut Tracker</p>
          <button type="button" onClick={onLogout} style={s.logoutBtn}>登出</button>
        </div>
        <h1 style={s.title}>選擇專案</h1>
        <p style={s.userInfo}>
          已登入：{userEmail || '（未知使用者）'}
          {isSuperAdmin && <span style={s.adminBadge}>super_admin</span>}
        </p>

        {projects === null && !error && (
          <p style={s.loading}>讀取中⋯</p>
        )}

        {error && (
          <p style={s.error}>讀取失敗：{error}</p>
        )}

        {projects && projects.length === 0 && !showForm && (
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

        {isSuperAdmin && !showForm && (
          <button type="button" onClick={() => setShowForm(true)} style={s.addBtn}>
            ＋ 新增專案
          </button>
        )}

        {isSuperAdmin && showForm && (
          <AddProjectForm
            onCancel={() => setShowForm(false)}
            onCreated={async (p) => {
              setShowForm(false)
              await refresh()
              onPick(p)
            }}
          />
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// 內嵌表單
// ----------------------------------------------------------------

interface FormProps {
  onCancel: () => void
  onCreated: (p: ProjectConfig) => void
}

function AddProjectForm({ onCancel, onCreated }: FormProps) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<ProjectType>('series')
  const [episodeCount, setEpisodeCount] = useState('12')
  const [episodePrefix, setEpisodePrefix] = useState('ep')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const idOk = /^[a-z][a-z0-9_]{1,30}$/.test(id)
  const canSubmit =
    idOk && name.trim() !== '' &&
    (type === 'film' || (Number(episodeCount) >= 1 && Number(episodeCount) <= 99 && episodePrefix.trim() !== ''))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setErr(null)
    try {
      const svc = getDataService()
      const p: ProjectConfig = {
        id,
        name: name.trim(),
        type,
        sheetId: '',
        ...(type === 'series' ? {
          episodeCount: Number(episodeCount),
          episodePrefix: episodePrefix.trim(),
        } : {}),
      }
      await svc.createProject(p)
      onCreated(p)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      <div style={s.formHeader}>新增專案</div>

      <label style={s.field}>
        <span style={s.fieldLabel}>專案 ID（英文小寫 slug，之後不能改）</span>
        <input
          type="text"
          value={id}
          onChange={e => setId(e.target.value.toLowerCase())}
          placeholder="例：yinluren"
          style={s.input}
          autoFocus
        />
        {id !== '' && !idOk && (
          <span style={s.hint}>只能 a-z、0-9、底線，開頭要是字母，2–31 字元</span>
        )}
      </label>

      <label style={s.field}>
        <span style={s.fieldLabel}>專案中文名</span>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例：引路人"
          style={s.input}
        />
      </label>

      <div style={s.field}>
        <span style={s.fieldLabel}>類型</span>
        <div style={s.radioGroup}>
          <label style={s.radioLabel}>
            <input
              type="radio"
              name="type"
              checked={type === 'series'}
              onChange={() => setType('series')}
            />
            <span>劇集</span>
          </label>
          <label style={s.radioLabel}>
            <input
              type="radio"
              name="type"
              checked={type === 'film'}
              onChange={() => setType('film')}
            />
            <span>電影</span>
          </label>
        </div>
      </div>

      {type === 'series' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ ...s.field, flex: 1 }}>
            <span style={s.fieldLabel}>集數</span>
            <input
              type="number"
              min={1}
              max={99}
              value={episodeCount}
              onChange={e => setEpisodeCount(e.target.value)}
              style={s.input}
            />
          </label>
          <label style={{ ...s.field, flex: 1 }}>
            <span style={s.fieldLabel}>集數前綴</span>
            <input
              type="text"
              value={episodePrefix}
              onChange={e => setEpisodePrefix(e.target.value)}
              placeholder="ep"
              style={s.input}
            />
          </label>
        </div>
      )}

      {err && <p style={s.error}>建立失敗：{err}</p>}

      <div style={s.formActions}>
        <button type="button" onClick={onCancel} style={s.cancelBtn} disabled={submitting}>
          取消
        </button>
        <button type="submit" disabled={!canSubmit || submitting} style={s.submitBtn}>
          {submitting ? '建立中⋯' : '建立'}
        </button>
      </div>
    </form>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--bg)', padding: 16,
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
  userInfo: { fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 },
  adminBadge: {
    fontSize: 10, padding: '2px 6px', borderRadius: 4,
    background: '#3B2F10', color: '#FFC107', fontWeight: 600,
    letterSpacing: '0.04em',
  },
  loading: { fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0' },
  error: { fontSize: 13, color: 'var(--color-missing)', textAlign: 'center', padding: '8px 0', margin: 0 },
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
  addBtn: {
    width: '100%', marginTop: 12, padding: '12px',
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px dashed var(--border)', borderRadius: 8,
    cursor: 'pointer', fontSize: 13,
  },
  form: {
    marginTop: 16, padding: 16,
    background: '#111', border: '1px solid var(--border)',
    borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12,
  },
  formHeader: {
    fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)', paddingBottom: 8,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary)' },
  input: {
    padding: '8px 10px', background: '#000', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
    fontFamily: 'inherit',
  },
  hint: { fontSize: 11, color: 'var(--color-missing)' },
  radioGroup: { display: 'flex', gap: 16, paddingTop: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' },
  formActions: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  cancelBtn: {
    padding: '8px 16px', background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  submitBtn: {
    padding: '8px 16px', background: '#FFC107', color: '#000',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
}
