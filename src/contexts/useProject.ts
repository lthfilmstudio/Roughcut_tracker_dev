import { useContext } from 'react'
import { ProjectContext, type ProjectContextValue } from './projectContextValue'

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) throw new Error('useProject must be used inside ProjectProvider')
  return context
}
