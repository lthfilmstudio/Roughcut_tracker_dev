import { useEffect, useState } from 'react'
import { getDataService } from '../services'
import type { ProjectConfig, ProjectType } from '../config/projectConfig'
import ManageMembersModal from './ManageMembersModal'

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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)

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
    let active = true
    const svc = getDataService()
    svc.getProjects()
      .then(list => { if (active) setProjects(list) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)) })
    svc.isSuperAdmin()
      .then(value => { if (active) setIsSuperAdmin(value) })
      .catch(() => { if (active) setIsSuperAdmin(false) })
    return () => { active = false }
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
              <li key={p.id} style={s.projectRow}>
                <button type="button" onClick={() => onPick(p)} style={s.projectBtn}>
                  <span style={s.projectName}>{p.name}</span>
                  <span style={s.projectMeta}>
                    {p.type === 'series' ? `劇集 · ${p.episodeCount ?? '?'} 集` : '電影'}
                  </span>
                </button>
                {isSuperAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setManagingId(p.id) }}
                      style={s.manageIcon}
                      title={`管理 ${p.name} 的成員`}
                      aria-label="管理成員"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeletingId(p.id) }}
                      style={s.deleteIcon}
                      title={`刪除 ${p.name}`}
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {managingId && projects && (() => {
          const target = projects.find(p => p.id === managingId)
          if (!target) return null
          return (
            <ManageMembersModal
              project={target}
              currentUserEmail={userEmail}
              onClose={() => setManagingId(null)}
            />
          )
        })()}

        {deletingId && projects && (() => {
          const target = projects.find(p => p.id === deletingId)
          if (!target) return null
          return (
            <DeleteProjectConfirm
              project={target}
              onCancel={() => setDeletingId(null)}
              onDeleted={async () => {
                setDeletingId(null)
                await refresh()
              }}
            />
          )
        })()}

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

// ----------------------------------------------------------------
// 刪除確認 Modal（防呆：要輸入中文名才能刪）
// ----------------------------------------------------------------

interface DeleteProps {
  project: ProjectConfig
  onCancel: () => void
  onDeleted: () => void
}

function DeleteProjectConfirm({ project, onCancel, onDeleted }: DeleteProps) {
  const [size, setSize] = useState<{ episodes: number; scenes: number } | null>(null)
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getDataService().getProjectSize(project.id)
      .then(setSize)
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [project.id])

  const canDelete = typed.trim() === project.name && !submitting

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setErr(null)
    try {
      await getDataService().deleteProject(project.id)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalTitle}>刪除專案</div>
        <p style={s.modalProjectName}>{project.name}</p>
        <p style={s.modalWarn}>
          此操作將永久刪除{' '}
          {size ? (
            <strong style={{ color: '#FF5252' }}>
              {size.episodes} 集、{size.scenes} 場次資料
            </strong>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>讀取中⋯</span>
          )}
          。<strong style={{ color: '#FF5252' }}>無法還原。</strong>
        </p>

        <label style={s.field}>
          <span style={s.fieldLabel}>
            請輸入專案中文名「<strong>{project.name}</strong>」以確認刪除
          </span>
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={project.name}
            style={s.input}
            autoFocus
          />
        </label>

        {err && <p style={s.error}>刪除失敗：{err}</p>}

        <div style={s.formActions}>
          <button type="button" onClick={onCancel} style={s.cancelBtn} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            style={{ ...s.submitBtn, ...s.deleteBtn, opacity: canDelete ? 1 : 0.4 }}
          >
            {submitting ? '刪除中⋯' : '確定刪除'}
          </button>
        </div>
      </div>
    </div>
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
    flex: 1, padding: '14px 16px',
    background: '#111', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 8,
    cursor: 'pointer', textAlign: 'left',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    minWidth: 0,
  },
  projectName: { fontWeight: 600, fontSize: 15 },
  projectMeta: { fontSize: 12, color: 'var(--text-secondary)' },
  projectRow: { display: 'flex', alignItems: 'stretch', gap: 6 },
  manageIcon: {
    flex: '0 0 auto', width: 40, minHeight: '100%',
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 8,
    cursor: 'pointer', fontSize: 16, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  },
  deleteIcon: {
    flex: '0 0 auto', width: 40, minHeight: '100%',
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 8,
    cursor: 'pointer', fontSize: 14, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  },
  modalBox: {
    width: 400, maxWidth: '100%', padding: 24,
    background: 'var(--card-bg)', borderRadius: 12,
    border: '1px solid #FF5252', display: 'flex', flexDirection: 'column', gap: 12,
  },
  modalTitle: {
    fontSize: 16, fontWeight: 600, color: '#FF5252',
  },
  modalProjectName: {
    fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0,
  },
  modalWarn: {
    fontSize: 13, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.6,
  },
  deleteBtn: {
    background: '#FF5252', color: '#FFFFFF',
  },
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
