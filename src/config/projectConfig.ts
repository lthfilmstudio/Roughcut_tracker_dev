export type ProjectType = 'series' | 'film'

export interface ProjectConfig {
  id: string
  name: string
  type: ProjectType
  sheetId: string
  passwordHash?: string
  episodes?: {
    count: number
    prefix: string
  }
  sceneTabName?: string
}

export const CURRENT_PROJECT: ProjectConfig = {
  id: 'beicheng',
  name: '北城百畫帖',
  type: 'series',
  sheetId: '1J5LdXoTVzf2xWE6YsjZ7Y1Wk6xOWLwTLHBi2ohkTeus',
  episodes: { count: 12, prefix: 'ep' },
}

export function getTabNames(p: ProjectConfig = CURRENT_PROJECT): string[] {
  if (p.type === 'series' && p.episodes) {
    return Array.from({ length: p.episodes.count }, (_, i) =>
      `${p.episodes!.prefix}${String(i + 1).padStart(2, '0')}`
    )
  }
  if (p.type === 'film') {
    return [p.sceneTabName ?? 'Scenes']
  }
  return []
}

export function projectTitle(p: ProjectConfig = CURRENT_PROJECT): string {
  return p.type === 'series' ? `劇集《${p.name}》` : `電影《${p.name}》`
}

export function hasSummaryTab(p: ProjectConfig = CURRENT_PROJECT): boolean {
  return p.type === 'series'
}
