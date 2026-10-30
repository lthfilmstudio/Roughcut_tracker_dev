import { formatDate, formatRoughcutLength } from './stats.ts'
import type { SceneRow } from '../types/index.ts'

type BatchStatusChoice =
  | 'unchanged'
  | 'roughcut'
  | 'finecut'
  | 'deleted'
  | 'clear'

type BatchDateMode = 'unchanged' | 'set' | 'clear'
type BatchLengthMode = 'unchanged' | 'set' | 'clear'

export interface BatchUpdateSettings {
  status: BatchStatusChoice
  dateMode: BatchDateMode
  date: string
  lengthMode: BatchLengthMode
  length: string
}

export type BatchScenePatch = Partial<Pick<SceneRow, 'status' | 'roughcutDate' | 'roughcutLength'>>

interface BatchUpdatePlan {
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
  if (settings.lengthMode === 'set' && !formatRoughcutLength(settings.length)) return null

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

  if (settings.lengthMode !== 'unchanged') {
    patch.roughcutLength = settings.lengthMode === 'set' ? formatRoughcutLength(settings.length) : ''
    changes.push(patch.roughcutLength ? `長度：${patch.roughcutLength}` : '長度：清除')
  }

  return changes.length > 0 ? { patch, changes } : null
}

export function applyBatchScenePatch(scene: SceneRow, patch: BatchScenePatch): SceneRow {
  return { ...scene, ...patch }
}

export function hasBatchSceneChanges(scene: SceneRow, patch: BatchScenePatch): boolean {
  return (
    ('status' in patch && scene.status !== patch.status)
    || ('roughcutDate' in patch && scene.roughcutDate !== patch.roughcutDate)
    || ('roughcutLength' in patch && scene.roughcutLength !== patch.roughcutLength)
  )
}
