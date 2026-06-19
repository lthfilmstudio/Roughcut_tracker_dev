import { useEffect, useState } from 'react'
import { getDataService } from '../services'
import type { ProjectConfig } from '../config/projectConfig'
import type { ProjectMember, MemberRole, PendingInvite } from '../services/dataService'

interface Props {
  project: ProjectConfig
  currentUserEmail: string | null
  onClose: () => void
}

export default function ManageMembersModal({ project, currentUserEmail, onClose }: Props) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [pending, setPending] = useState<PendingInvite[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const svc = getDataService()
      const [list, pendingList] = await Promise.all([
        svc.listProjectMembers(project.id),
        svc.listPendingInvites(project.id),
      ])
      setMembers(list)
      setPending(pendingList)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { refresh() }, [project.id])

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.title}>成員管理</div>
            <div style={s.subtitle}>{project.name}</div>
          </div>
          <button type="button" onClick={onClose} style={s.closeBtn}>✕</button>
        </div>

        <AddMemberForm projectId={project.id} onAdded={refresh} />

        <div style={s.divider} />

        <div style={s.sectionLabel}>現有成員</div>
        {members === null && !loadErr && <p style={s.loading}>讀取中⋯</p>}
        {loadErr && <p style={s.error}>讀取失敗：{loadErr}</p>}
        {members && members.length === 0 && (
          <p style={s.empty}>目前沒有成員（只有 super_admin 看得到此專案）</p>
        )}
        {members && members.length > 0 && (
          <ul style={s.memberList}>
            {members.map(m => (
              <MemberRow
                key={m.userId}
                member={m}
                projectId={project.id}
                isSelf={m.email === currentUserEmail}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}

        {pending && pending.length > 0 && (
          <>
            <div style={s.sectionLabel}>待加入（對方登入後自動生效）</div>
            <ul style={s.memberList}>
              {pending.map(inv => (
                <PendingRow key={inv.id} invite={inv} onChanged={refresh} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// 新增成員表單
// ----------------------------------------------------------------

function AddMemberForm({ projectId, onAdded }: { projectId: string; onAdded: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('editor')
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailOk || submitting) return
    setSubmitting(true)
    setMsg(null)
    try {
      const res = await getDataService().addProjectMemberByEmail(projectId, email.trim(), role)
      if (res.status === 'pending') {
        setMsg({
          type: 'ok',
          text: `${res.email} 尚未登入過，已建立邀請。對方第一次登入 tracker.lthfilmstudio.com 時會自動加入。`,
        })
      } else {
        setMsg({ type: 'ok', text: `${res.email} 已加入為 ${role}` })
      }
      setEmail('')
      await onAdded()
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleAdd} style={s.form}>
      <div style={s.sectionLabel}>邀請新成員</div>
      <div style={s.inlineRow}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="user@gmail.com"
          style={{ ...s.input, flex: 1 }}
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value as MemberRole)}
          style={s.select}
        >
          <option value="editor">editor</option>
          <option value="admin">admin</option>
          <option value="viewer">viewer</option>
        </select>
        <button type="submit" disabled={!emailOk || submitting} style={s.primaryBtn}>
          {submitting ? '加入中⋯' : '加入'}
        </button>
      </div>
      {msg && (
        <p style={{ ...s.msg, ...(
          msg.type === 'ok' ? s.msgOk :
          msg.type === 'warn' ? s.msgWarn :
          s.msgErr
        ) }}>
          {msg.text}
        </p>
      )}
    </form>
  )
}

// ----------------------------------------------------------------
// 單一成員列（移除按鈕）
// ----------------------------------------------------------------

function MemberRow({
  member, projectId, isSelf, onChanged,
}: {
  member: ProjectMember
  projectId: string
  isSelf: boolean
  onChanged: () => Promise<void>
}) {
  const [removing, setRemoving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleRemove = async () => {
    setRemoving(true)
    setErr(null)
    try {
      await getDataService().removeProjectMember(projectId, member.userId)
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setRemoving(false)
    }
  }

  return (
    <li style={s.memberRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.memberEmail}>
          {member.email}
          {isSelf && <span style={s.selfBadge}>（你）</span>}
        </div>
        <div style={s.memberMeta}>{member.role}</div>
      </div>
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={isSelf}
          title={isSelf ? '無法移除自己' : '移除'}
          style={{ ...s.rowRemoveBtn, opacity: isSelf ? 0.3 : 1 }}
        >
          移除
        </button>
      ) : (
        <div style={s.confirmRow}>
          <button type="button" onClick={() => setConfirm(false)} style={s.cancelTiny}>
            取消
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            style={s.removeTiny}
          >
            {removing ? '⋯' : '確定'}
          </button>
        </div>
      )}
      {err && <div style={s.rowErr}>{err}</div>}
    </li>
  )
}

// ----------------------------------------------------------------
// Pending invite 列（取消邀請）
// ----------------------------------------------------------------

function PendingRow({ invite, onChanged }: { invite: PendingInvite; onChanged: () => Promise<void> }) {
  const [cancelling, setCancelling] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleCancel = async () => {
    setCancelling(true)
    setErr(null)
    try {
      await getDataService().cancelPendingInvite(invite.id)
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setCancelling(false)
    }
  }

  return (
    <li style={{ ...s.memberRow, borderStyle: 'dashed', opacity: 0.85 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.memberEmail}>{invite.email}</div>
        <div style={s.memberMeta}>{invite.role} · 等待登入</div>
      </div>
      <button
        type="button"
        onClick={handleCancel}
        disabled={cancelling}
        style={s.rowRemoveBtn}
      >
        {cancelling ? '⋯' : '取消邀請'}
      </button>
      {err && <div style={s.rowErr}>{err}</div>}
    </li>
  )
}

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  },
  box: {
    width: 480, maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto',
    padding: 24, background: 'var(--card-bg)', borderRadius: 12,
    border: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  title: { fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 },
  closeBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: 6, fontSize: 12,
    padding: '4px 10px', cursor: 'pointer',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-secondary)',
    letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
  },
  inlineRow: { display: 'flex', gap: 6, alignItems: 'stretch' },
  input: {
    padding: '8px 10px', background: '#000', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
    fontFamily: 'inherit', minWidth: 0,
  },
  select: {
    padding: '8px 10px', background: '#000', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
    fontFamily: 'inherit',
  },
  primaryBtn: {
    padding: '8px 16px', background: '#FFC107', color: '#000',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  msg: { fontSize: 12, margin: 0, padding: '6px 10px', borderRadius: 4 },
  msgOk: { background: '#0F2417', color: '#4CAF50' },
  msgWarn: { background: '#2E2410', color: '#FFC107' },
  msgErr: { background: '#2A1212', color: '#FF5252' },
  divider: { height: 1, background: 'var(--border)' },
  loading: { fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' },
  error: { fontSize: 13, color: '#FF5252' },
  empty: { fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' },
  memberList: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  memberRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', background: '#111',
    border: '1px solid var(--border)', borderRadius: 8,
    flexWrap: 'wrap',
  },
  memberEmail: { fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-all' },
  selfBadge: { fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 },
  memberMeta: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  rowRemoveBtn: {
    padding: '4px 10px', background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  confirmRow: { display: 'flex', gap: 4 },
  cancelTiny: {
    padding: '4px 10px', background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  removeTiny: {
    padding: '4px 10px', background: '#FF5252', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  rowErr: { width: '100%', fontSize: 11, color: '#FF5252', marginTop: 4 },
}
