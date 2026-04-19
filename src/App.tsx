import { useState, useEffect, useRef } from 'react'
import { useAuth } from './hooks/useAuth'
import { useEpisodesCache } from './hooks/useEpisodesCache'
import LoginScreen from './components/LoginScreen'
import Dashboard from './components/Dashboard'
import EpisodeDetail from './components/EpisodeDetail'
import { getTabNames } from './config/projectConfig'
import { useProject } from './contexts/ProjectContext'
import './App.css'

const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD ?? ''

type View = { page: 'dashboard' } | { page: 'episode'; ep: string }

export default function App() {
  const { project } = useProject()
  const isFilm = project.type === 'film'
  const filmTab = getTabNames(project)[0] ?? 'Scenes'
  const initialView: View = isFilm
    ? { page: 'episode', ep: filmTab }
    : { page: 'dashboard' }

  const { isAuthenticated, accessToken, login, logout } = useAuth()
  const [passwordOk, setPasswordOk] = useState(
    () => sessionStorage.getItem('app_pwd_ok') === '1',
  )
  const [view, setView] = useState<View>(initialView)
  const loginTriggered = useRef(false)
  const cache = useEpisodesCache(accessToken)

  useEffect(() => {
    const isOAuthCallback = window.location.hash.includes('access_token')
    if (passwordOk && !isAuthenticated && !isOAuthCallback && !loginTriggered.current) {
      loginTriggered.current = true
      login()
    }
  }, [passwordOk, isAuthenticated])

  function handlePasswordSubmit(pwd: string): boolean {
    if (pwd === APP_PASSWORD) {
      sessionStorage.setItem('app_pwd_ok', '1')
      setPasswordOk(true)
      return true
    }
    return false
  }

  function handleLogout() {
    sessionStorage.removeItem('app_pwd_ok')
    setPasswordOk(false)
    logout()
  }

  const waitingForOAuth = passwordOk && !isAuthenticated

  if (!passwordOk || !isAuthenticated || !accessToken) {
    return <LoginScreen onSubmit={handlePasswordSubmit} waiting={waitingForOAuth} />
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
