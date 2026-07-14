import { formatDate } from './stats.ts'
import type { SceneRow } from '../types/index.ts'

export type BatchStatusChoice =
  | 'unchanged'
  | 'roughcut'
  | 'finecut'
  | 'deleted'
  | 'clear'

export type BatchDateMode = 'unchanged' | 'set' | 'clear'

export interface BatchUpdateSettings {
  status: BatchStatusChoice
  dateMode: BatchDateMode
  date: string
}

export type BatchScenePatch = Partial<Pick<SceneRow, 'status' | 'roughcutDate'>>

export interface BatchUpdatePlan {
  patch: BatchScenePatch
  changes: string[]
}

const statusValues: Record<Exclude<BatchStatusChoice, 'unchanged'>, string> = {
  roughcut: '已初剪',
  finecut: '已精剪',
  deleted: '整場刪除',
  clear: '',
}

export function buildBatchUpdatePlan(settings: BatchUpdateSettings): BatchUpdatePlan | null {
  if (settings.dateMode === 'set' && !settings.date.trim()) return null

  const patch: BatchScenePatch = {}
  const changes: string[] = []

  if (settings.status !== 'unchanged') {
    patch.status = statusValues[settings.status]
    changes.push(patch.status ? `狀態：${patch.status}` : '狀態：清除')
  }

  if (settings.dateMode !== 'unchanged') {
    patch.roughcutDate = settings.dateMode === 'set' ? formatDate(settings.date) : ''
    changes.push(patch.roughcutDate ? `日期：${patch.roughcutDate}` : '日期：清除')
  }

  return changes.length > 0 ? { patch, changes } : null
}

export function applyBatchScenePatch(scene: SceneRow, patch: BatchScenePatch): SceneRow {
  return { ...scene, ...patch }
}
