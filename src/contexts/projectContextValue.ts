import { createContext } from 'react'
import type { ProjectConfig } from '../config/projectConfig'

export interface ProjectContextValue {
  project: ProjectConfig
  setProject: (project: ProjectConfig) => void
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)
