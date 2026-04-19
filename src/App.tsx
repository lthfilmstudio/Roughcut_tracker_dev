import { useState, useEffect, useRef } from 'react'
import bcrypt from 'bcryptjs'
import { useAuth } from './hooks/useAuth'
import { useEpisodesCache } from './hooks/useEpisodesCache'
import LoginScreen from './components/LoginScreen'
import Dashboard from './components/Dashboard'
import EpisodeDetail from './components/EpisodeDetail'
import AdminDashboard from './components/AdminDashboard'
import { getTabNames } from './config/projectConfig'
import { useProject } from './contexts/ProjectContext'
import { getDataService } from './services'
import './App.css'

const PENDING_PWD_KEY = 'pending_pwd'
const MATCHED_PROJECT_KEY = 'matched_project_id'
const ADMIN_MODE_KEY = 'admin_mode'
const ADMIN_VERIFIED_KEY = 'admin_verified'
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? ''

type View = { page: 'dashboard' } | { page: 'episode'; ep: string }

export default function App() {
  const { project, setProject } = useProject()
  const { isAuthenticated, accessToken, login, logout } = useAuth()

  const [adminMode, setAdminMode] = useState<boolean>(
    () => sessionStorage.getItem(ADMIN_MODE_KEY) === '1' || window.location.hash === '#admin',
  )
  const [adminVerified, setAdminVerified] = useState<boolean>(
    () => sessionStorage.getItem(ADMIN_VERIFIED_KEY) === '1',
  )
  const [matchedId, setMatchedId] = useState<string | null>(
    () => sessionStorage.getItem(MATCHED_PROJECT_KEY),
  )
  const [verifying, setVerifying] = useState(false)
  const [loginError, setLoginError] = useState('')
  const verifiedRef = useRef(false)

  const authed = !!matchedId && !!accessToken && project.id === matchedId
  const effectiveToken = authed ? accessToken : null
  const cache = useEpisodesCache(effectiveToken)

  const isFilm = project.type === 'film'
  const filmTab = getTabNames(project)[0] ?? 'Scenes'
  const [view, setView] = useState<View>(
    () => (isFilm ? { page: 'episode', ep: filmTab } : { page: 'dashboard' }),
  )

  // 從 URL hash 進入 admin mode
  useEffect(() => {
    if (window.location.hash === '#admin') {
      sessionStorage.setItem(ADMIN_MODE_KEY, '1')
      setAdminMode(true)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // 專案切換時重置 view
  useEffect(() => {
    if (!authed) return
    setView(project.type === 'film'
      ? { page: 'episode', ep: getTabNames(project)[0] ?? 'Scenes' }
      : { page: 'dashboard' })
  }, [matchedId, authed, project])

  // OAuth 完成後：驗證 pending 密碼 或 還原已登入 project
  useEffect(() => {
    if (!accessToken || verifiedRef.current || verifying) return
    if (adminMode) return // admin 流程不需要比對專案密碼

    const pendingPwd = sessionStorage.getItem(PENDING_PWD_KEY)
    const savedId = sessionStorage.getItem(MATCHED_PROJECT_KEY)

    if (pendingPwd) {
      verifyPassword(pendingPwd, accessToken)
    } else if (savedId && project.id !== savedId) {
      restoreProject(savedId, accessToken)
    } else if (savedId && project.id === savedId) {
      verifiedRef.current = true
    }
  }, [accessToken, adminMode])

  async function verifyPassword(pwd: string, token: string) {
    setVerifying(true)
    setLoginError('')
    try {
      const svc = getDataService(token)
      const projects = await svc.getProjects()
      const match = projects.find(p => p.passwordHash && bcrypt.compareSync(pwd, p.passwordHash))
      sessionStorage.removeItem(PENDING_PWD_KEY)
      if (match) {
        setProject(match)
        setMatchedId(match.id)
        sessionStorage.setItem(MATCHED_PROJECT_KEY, match.id)
        verifiedRef.current = true
      } else {
        setLoginError('密碼錯誤，請重試')
        logout()
      }
    } catch (e: unknown) {
      sessionStorage.removeItem(PENDING_PWD_KEY)
      setLoginError('連線失敗：' + (e instanceof Error ? e.message : String(e)))
      logout()
    } finally {
      setVerifying(false)
    }
  }

  async function restoreProject(id: string, token: string) {
    setVerifying(true)
    try {
      const svc = getDataService(token)
      const projects = await svc.getProjects()
      const match = projects.find(p => p.id === id)
      if (match) {
        setProject(match)
        verifiedRef.current = true
      } else {
        sessionStorage.removeItem(MATCHED_PROJECT_KEY)
        setMatchedId(null)
        logout()
      }
    } catch {
      sessionStorage.removeItem(MATCHED_PROJECT_KEY)
      setMatchedId(null)
      logout()
    } finally {
      setVerifying(false)
    }
  }

  function handlePasswordSubmit(pwd: string) {
    sessionStorage.setItem(PENDING_PWD_KEY, pwd)
    setLoginError('')
    login()
  }

  function handleAdminPasswordSubmit(pwd: string) {
    if (!ADMIN_PASSWORD) {
      setLoginError('VITE_ADMIN_PASSWORD 未設定')
      return
    }
    if (pwd !== ADMIN_PASSWORD) {
      setLoginError('管理者密碼錯誤')
      return
    }
    setLoginError('')
    sessionStorage.setItem(ADMIN_VERIFIED_KEY, '1')
    setAdminVerified(true)
    if (!accessToken) login()
  }

  function handleAdminLogout() {
    sessionStorage.removeItem(ADMIN_MODE_KEY)
    sessionStorage.removeItem(ADMIN_VERIFIED_KEY)
    setAdminMode(false)
    setAdminVerified(false)
    setLoginError('')
    logout()
  }

  function handleLogout() {
    sessionStorage.removeItem(MATCHED_PROJECT_KEY)
    sessionStorage.removeItem(PENDING_PWD_KEY)
    setMatchedId(null)
    verifiedRef.current = false
    setLoginError('')
    logout()
  }

  if (adminMode) {
    if (adminVerified && accessToken) {
      return <AdminDashboard token={accessToken} onLogout={handleAdminLogout} />
    }
    const waiting = adminVerified && !isAuthenticated
    return (
      <LoginScreen
        title="管理者登入"
        sublabel="Roughcut Tracker · Admin"
        hint="忘記密碼？請翻開 GitHub Secrets"
        onSubmit={handleAdminPasswordSubmit}
        waiting={waiting}
        waitingLabel="正在連結 Google 帳號⋯"
        error={loginError}
      />
    )
  }

  if (!authed) {
    const hasPending = !!sessionStorage.getItem(PENDING_PWD_KEY)
    const waiting = verifying || (hasPending && !isAuthenticated)
    const waitingLabel = verifying ? '驗證中⋯' : '正在連結 Google 帳號⋯'
    return (
      <LoginScreen
        onSubmit={handlePasswordSubmit}
        waiting={waiting}
        waitingLabel={waitingLabel}
        error={loginError}
      />
    )
  }

  if (view.page === 'episode') {
    return (
      <EpisodeDetail
        episode={view.ep}
        token={accessToken}
        cache={cache}
        onNavigate={(ep) => setView({ page: 'episode', ep })}
        onBack={isFilm ? handleLogout : () => setView({ page: 'dashboard' })}
        backLabel={isFilm ? '登出' : '← 返回總覽'}
      />
    )
  }

  return (
    <Dashboard
      token={accessToken}
      cache={cache}
      onSelectEpisode={(ep) => setView({ page: 'episode', ep })}
      onLogout={handleLogout}
    />
  )
}
