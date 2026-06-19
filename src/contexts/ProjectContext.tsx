import { useState } from 'react'
import type { ReactNode } from 'react'
import { CURRENT_PROJECT } from '../config/projectConfig'
import type { ProjectConfig } from '../config/projectConfig'
import { ProjectContext } from './projectContextValue'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<ProjectConfig>(CURRENT_PROJECT)
  return (
    <ProjectContext.Provider value={{ project, setProject }}>
      {children}
    </ProjectContext.Provider>
  )
}
