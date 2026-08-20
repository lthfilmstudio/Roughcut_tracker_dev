import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDataService } from '../services'
import { normalizeScene, computeEpisodeStats } from '../lib/stats'
import { sortScenes } from '../lib/sceneSort'
import { getTabNames, hasSummaryTab } from '../config/projectConfig'
import { useProject } from '../contexts/ProjectContext'
import type { SceneRow } from '../types'

export type EpisodesMap = Record<string, SceneRow[]>
export type MetaMap = Record<string, string>

export interface EpisodesCache {
  scenes: EpisodesMap | null
  meta: MetaMap
  loading: boolean
  error: string
  reload: () => Promise<void>
  setEpisodeScenes: (ep: string, updater: (prev: SceneRow[]) => SceneRow[]) => SceneRow[]
  setMetaValue: (key: string, value: string) => Promise<void>
}

export function useEpisodesCache(token: string | null): EpisodesCache {
  const { project } = useProject()
  const episodes = useMemo(() => getTabNames(project), [project])
  const [scenes, setScenes] = useState<EpisodesMap | null>(null)
  const [meta, setMeta] = useState<MetaMap>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadedKeyRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const svc = getDataService(token)
      const [batch, metaMap] = await Promise.all([
        svc.fetchEpisodesBatch(project, episodes),
        svc.fetchMeta(project),
      ])
      const normalized: EpisodesMap = {}
      const rewriteTargets: { ep: string; updates: { rowIndex: number; scene: SceneRow }[] }[] = []
      for (const ep of episodes) {
        const raw = batch[ep] ?? []
        const n = raw.map(normalizeScene)
        const sorted = sortScenes(n)
        normalized[ep] = sorted

        // 只挑「內容真的被 normalize 改過」或「排序位置真的變了」的場次回寫，
        // 不要整集一次 upsert（會連沒變的場次也戳一次 updated_at）。
        const contentChanged = n.map((nn, i) => (
          nn.roughcutLength !== raw[i].roughcutLength || nn.roughcutDate !== raw[i].roughcutDate
        ))
        const origIndexOf = new Map<SceneRow, number>(n.map((scene, i) => [scene, i]))
        const updates = sorted.flatMap((scene, newIndex) => {
          const origIndex = origIndexOf.get(scene)!
          if (origIndex !== newIndex || contentChanged[origIndex]) {
            return [{ rowIndex: newIndex, scene }]
          }
          return []
        })
        if (updates.length > 0) {
          rewriteTargets.push({ ep, updates })
        }
      }
      setScenes(normalized)
      setMeta(metaMap)
      loadedKeyRef.current = `${token}|${project.id}`

      for (const { ep, updates } of rewriteTargets) {
        svc.batchUpdateScenes(project, ep, updates).catch(() => {})
      }
      if (hasSummaryTab(project)) {
        const items = episodes.map(ep => ({ ep, stats: computeEpisodeStats(normalized[ep]) }))
        svc.batchUpdateSummary(project, items).catch(() => {})
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token, project, episodes])

  useEffect(() => {
    if (!token) {
      setScenes(null)
      setMeta({})
      loadedKeyRef.current = null
      return
    }
    const key = `${token}|${project.id}`
    if (loadedKeyRef.current === key) return
    load()
  }, [token, project, load])

  const setEpisodeScenes = useCallback(
    (ep: string, updater: (prev: SceneRow[]) => SceneRow[]): SceneRow[] => {
      let next: SceneRow[] = []
      setScenes(prev => {
        const base = prev ?? {}
        next = updater(base[ep] ?? [])
        return { ...base, [ep]: next }
      })
      return next
    },
    [],
  )

  const setMetaValue = useCallback(
    async (key: string, value: string): Promise<void> => {
      if (!token) return
      setMeta(prev => ({ ...prev, [key]: value }))
      try {
        await getDataService(token).setMeta(project, key, value)
      } catch (e) {
        alert('儲存失敗：' + (e instanceof Error ? e.message : String(e)))
        throw e
      }
    },
    [token, project],
  )

  return { scenes, meta, loading, error, reload: load, setEpisodeScenes, setMetaValue }
}
