import { useState } from 'react'
import HelpModal from './HelpModal'

interface Props {
  onLogin: () => void | Promise<void>
  waiting?: boolean
  waitingLabel?: string
  error?: string
  title?: string
  sublabel?: string
  hint?: string
}

export default function LoginScreen({
  onLogin, waiting, waitingLabel, error,
  title = '登入以繼續',
  sublabel = 'Roughcut Tracker',
  hint = '登入後會看到你有權限的專案',
}: Props) {
  const [helpOpen, setHelpOpen] = useState(false)

  if (waiting) {
    return (
      <div style={s.wrapper}>
        <div style={s.card}>
          <p style={s.hint}>{waitingLabel ?? '正在連結 Google 帳號⋯'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <p style={s.label}>{sublabel}</p>
        <h1 style={s.title}>{title}</h1>
        <button type="button" onClick={() => onLogin()} style={s.googleBtn}>
          <span style={s.gIcon}>G</span>
          使用 Google 登入
        </button>
        {error && <p style={s.error}>{error}</p>}
        <p style={s.hint}>{hint}</p>
        <button type="button" style={s.helpLink} onClick={() => setHelpOpen(true)}>
          使用說明
        </button>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--bg)',
  },
  card: {
    width: 360, padding: '40px 40px 32px', background: 'var(--card-bg)',
    borderRadius: 12, border: '1px solid var(--border)',
  },
  label: {
    fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12,
    letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  title: { fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 28 },
  googleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    width: '100%', padding: 12,
    background: 'var(--text-primary)', color: 'var(--bg)',
    border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14,
    cursor: 'pointer',
  },
  gIcon: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, borderRadius: '50%',
    background: '#4285F4', color: '#fff', fontWeight: 700, fontSize: 13,
  },
  error: { fontSize: 13, color: 'var(--color-missing)', margin: '12px 0 0' },
  hint: { fontSize: 12, color: '#444', marginTop: 20, textAlign: 'center' },
  helpLink: {
    display: 'block', margin: '12px auto 0', background: 'transparent',
    border: 'none', color: 'var(--text-secondary)', fontSize: 12,
    textDecoration: 'underline', cursor: 'pointer', padding: 4,
  },
}
