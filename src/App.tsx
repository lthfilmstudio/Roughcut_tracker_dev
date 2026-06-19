import { useState, useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { useEpisodesCache } from './hooks/useEpisodesCache'
import LoginScreen from './components/LoginScreen'
import ProjectPicker from './components/ProjectPicker'
import Dashboard from './components/Dashboard'
import EpisodeDetail from './components/EpisodeDetail'
import QuickPage from './components/QuickPage'
import SupabasePreview from './components/SupabasePreview'
import { getTabNames, type ProjectConfig } from './config/projectConfig'
import { useProject } from './contexts/useProject'
import { getDataService } from './services'
import './App.css'

const PICKED_PROJECT_KEY = 'picked_project_id'

type View = { page: 'dashboard' } | { page: 'episode'; ep: string } | { page: 'quick' }

function useSupabasePreviewRoute(): boolean {
  const check = () => window.location.hash.startsWith('#supabase-preview')
  const [match, setMatch] = useState(check)
  useEffect(() => {
    const onChange = () => setMatch(check())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return match
}

export default function App() {
  const isSupabasePreview = useSupabasePreviewRoute()
  if (isSupabasePreview) return <SupabasePreview />
  return <MainApp />
}

function MainApp() {
  const { project, setProject } = useProject()
  const { isAuthenticated, accessToken, userEmail, login, logout } = useAuth()

  const [pickedId, setPickedId] = useState<string | null>(
    () => sessionStorage.getItem(PICKED_PROJECT_KEY),
  )
  const isFilm = project.type === 'film'
  const filmTab = getTabNames(project)[0] ?? 'Scenes'
  const [view, setView] = useState<View>(
    () => (isFilm ? { page: 'episode', ep: filmTab } : { page: 'dashboard' }),
  )

  // 登入後：如果有記憶中的 pickedId，自動還原 project context
  useEffect(() => {
    if (!isAuthenticated || !pickedId || project.id === pickedId) return
    getDataService().getProjects()
      .then(list => {
        const match = list.find(p => p.id === pickedId)
        if (match) {
          setProject(match)
          setView(match.type === 'film'
            ? { page: 'episode', ep: getTabNames(match)[0] ?? 'Scenes' }
            : { page: 'dashboard' })
        }
        else {
          sessionStorage.removeItem(PICKED_PROJECT_KEY)
          setPickedId(null)
        }
      })
      .catch(() => {
        sessionStorage.removeItem(PICKED_PROJECT_KEY)
        setPickedId(null)
      })
  }, [isAuthenticated, pickedId, project.id, setProject])

  const authed = isAuthenticated && !!pickedId && project.id === pickedId
  const cache = useEpisodesCache(authed ? accessToken : null)

  function handlePickProject(p: ProjectConfig) {
    setProject(p)
    setView(p.type === 'film'
      ? { page: 'episode', ep: getTabNames(p)[0] ?? 'Scenes' }
      : { page: 'dashboard' })
    setPickedId(p.id)
    sessionStorage.setItem(PICKED_PROJECT_KEY, p.id)
  }

  function handleSwitchProject() {
    sessionStorage.removeItem(PICKED_PROJECT_KEY)
    setPickedId(null)
  }

  async function handleLogout() {
    sessionStorage.removeItem(PICKED_PROJECT_KEY)
    setPickedId(null)
    await logout()
  }

  // 尚未登入 → Google OAuth
  if (!isAuthenticated) {
    return <LoginScreen onLogin={login} />
  }

  // 已登入但尚未選專案（或記憶中的不存在了）→ ProjectPicker
  if (!authed) {
    return (
      <ProjectPicker
        userEmail={userEmail}
        onPick={handlePickProject}
        onLogout={handleLogout}
      />
    )
  }

  // 以下是原本主流程（Dashboard / EpisodeDetail / QuickPage）
  if (view.page === 'quick') {
    return (
      <QuickPage
        token={accessToken ?? ''}
        cache={cache}
        onExit={isFilm ? handleSwitchProject : () => setView({ page: 'dashboard' })}
        exitLabel={isFilm ? '切換專案' : '← 返回'}
      />
    )
  }

  if (view.page === 'episode') {
    return (
      <EpisodeDetail
        episode={view.ep}
        token={accessToken ?? ''}
        cache={cache}
        onNavigate={(ep) => setView({ page: 'episode', ep })}
        onOpenQuick={() => setView({ page: 'quick' })}
        onBack={isFilm ? handleSwitchProject : () => setView({ page: 'dashboard' })}
        backLabel={isFilm ? '切換專案' : '← 返回'}
      />
    )
  }

  return (
    <Dashboard
      token={accessToken ?? ''}
      cache={cache}
      onSelectEpisode={(ep) => setView({ page: 'episode', ep })}
      onOpenQuick={() => setView({ page: 'quick' })}
      onLogout={handleSwitchProject}
      logoutLabel="切換專案"
    />
  )
}
