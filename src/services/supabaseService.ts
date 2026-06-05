import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DataService,
  CreateSheetResult,
  ProjectMember,
  MemberRole,
  AddMemberResult,
  PendingInvite,
} from './dataService'
import type { SceneRow, SummaryRow } from '../types'
import {
  computeEpisodeStats,
  parseSecs,
  secsToHMS,
  type EpisodeStats,
} from '../lib/stats'
import type { ProjectConfig, ProjectType } from '../config/projectConfig'
import { getSupabaseClient } from './supabaseClient'

// ============================================================
// SupabaseService
// 實作 DataService 介面，底層走 Supabase（Postgres + RLS）
// ============================================================

// DB 型別（對應 schema.sql）-------------------------------------

interface DbProject {
  id: string
  name: string
  type: ProjectType
  episode_count: number | null
  episode_prefix: string | null
  legacy_sheet_id: string | null
  created_at: string
  updated_at: string
}

interface DbScene {
  id: string
  episode_id: string
  scene_key: string
  roughcut_length_secs: number | null
  pages: number | null
  roughcut_date: string | null   // 'YYYY-MM-DD'
  status: string | null          // '已初剪' | '已精剪' | '整場刪除' | null
  missing_shots: boolean
  outline: string | null
  notes: string | null
  row_order: number
}

// 轉換函式 ------------------------------------------------------

function dbToSceneRow(s: DbScene): SceneRow {
  return {
    scene: s.scene_key,
    roughcutLength: s.roughcut_length_secs != null ? secsToHMS(s.roughcut_length_secs) : '',
    pages: s.pages != null ? String(s.pages) : '',
    roughcutDate: s.roughcut_date ? s.roughcut_date.replaceAll('-', '/') : '',
    status: s.status ?? '',
    missingShots: s.missing_shots ? 'true' : '',
    outline: s.outline ?? '',
    notes: s.notes ?? '',
  }
}

function sceneRowToDb(scene: SceneRow, episodeId: string, rowOrder: number): Omit<DbScene, 'id'> {
  return {
    episode_id: episodeId,
    scene_key: scene.scene.trim(),
    roughcut_length_secs: scene.roughcutLength.trim() ? parseSecs(scene.roughcutLength) : null,
    pages: scene.pages.trim() ? (parseFloat(scene.pages) || 0) : null,
    roughcut_date: ymdHyphen(scene.roughcutDate),
    status: toValidStatus(scene.status),
    missing_shots: !!scene.missingShots.trim() && scene.missingShots !== '否',
    outline: scene.outline.trim() || null,
    notes: scene.notes.trim() || null,
    row_order: rowOrder,
  }
}

function ymdHyphen(s: string): string | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function toValidStatus(s: string): string | null {
  const t = s.trim()
  if (t === '已初剪' || t === '已精剪' || t === '整場刪除') return t
  return null
}

function dbToProject(p: DbProject): ProjectConfig {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    sheetId: p.legacy_sheet_id || '',
    episodeCount: p.episode_count ?? undefined,
    episodePrefix: p.episode_prefix ?? undefined,
    createdAt: p.created_at,
  }
}

// ============================================================
// 主類別
// ============================================================

export class SupabaseService implements DataService {
  private client: SupabaseClient

  constructor(client: SupabaseClient = getSupabaseClient()) {
    this.client = client
  }

  // ---- 私有 helper ----

  private async getEpisodeId(projectId: string, epKey: string): Promise<string> {
    const { data, error } = await this.client
      .from('episodes')
      .select('id')
      .eq('project_id', projectId)
      .eq('ep_key', epKey)
      .maybeSingle()
    if (error) throw new Error(`找不到 ${projectId}/${epKey}: ${error.message}`)
    if (!data) throw new Error(`${projectId}/${epKey} 不存在`)
    return data.id
  }

  // ============================================================
  // projects
  // ============================================================

  async isSuperAdmin(): Promise<boolean> {
    const { data, error } = await this.client.rpc('is_super_admin')
    if (error) throw new Error(`isSuperAdmin: ${error.message}`)
    return data === true
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    const { data, error } = await this.client.rpc('list_project_members', { p_project_id: projectId })
    if (error) throw new Error(`listProjectMembers: ${error.message}`)
    return (data ?? []).map((r: { user_id: string; email: string; role: MemberRole; created_at: string }) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    }))
  }

  async addProjectMemberByEmail(projectId: string, email: string, role: MemberRole): Promise<AddMemberResult> {
    const { data, error } = await this.client.rpc('add_project_member_by_email', {
      p_email: email,
      p_project_id: projectId,
      p_role: role,
    })
    if (error) throw new Error(`addProjectMemberByEmail: ${error.message}`)
    return data as AddMemberResult
  }

  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc('remove_project_member', {
      p_user_id: userId,
      p_project_id: projectId,
    })
    if (error) throw new Error(`removeProjectMember: ${error.message}`)
  }

  async listPendingInvites(projectId: string): Promise<PendingInvite[]> {
    const { data, error } = await this.client.rpc('list_pending_invites', { p_project_id: projectId })
    if (error) throw new Error(`listPendingInvites: ${error.message}`)
    return (data ?? []).map((r: { id: string; email: string; role: MemberRole; created_at: string }) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    }))
  }

  async cancelPendingInvite(inviteId: string): Promise<void> {
    const { error } = await this.client.rpc('cancel_pending_invite', { p_invite_id: inviteId })
    if (error) throw new Error(`cancelPendingInvite: ${error.message}`)
  }

  async getProjectSize(id: string): Promise<{ episodes: number; scenes: number }> {
    const epRes = await this.client
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
    if (epRes.error) throw new Error(`getProjectSize episodes: ${epRes.error.message}`)

    const { data: epIds, error: epIdsErr } = await this.client
      .from('episodes').select('id').eq('project_id', id)
    if (epIdsErr) throw new Error(`getProjectSize epIds: ${epIdsErr.message}`)

    const ids = (epIds ?? []).map(r => r.id)
    let scenes = 0
    if (ids.length > 0) {
      const scRes = await this.client
        .from('scenes')
        .select('id', { count: 'exact', head: true })
        .in('episode_id', ids)
      if (scRes.error) throw new Error(`getProjectSize scenes: ${scRes.error.message}`)
      scenes = scRes.count ?? 0
    }

    return { episodes: epRes.count ?? 0, scenes }
  }

  async getProjects(): Promise<ProjectConfig[]> {
    const { data, error } = await this.client
      .from('projects')
      .select('*')
      .order('created_at')
    if (error) throw new Error(`getProjects: ${error.message}`)
    return (data ?? []).map(dbToProject)
  }

  async createProject(p: ProjectConfig): Promise<void> {
    const { error } = await this.client.from('projects').insert({
      id: p.id,
      name: p.name,
      type: p.type,
      episode_count: p.episodeCount ?? null,
      episode_prefix: p.episodePrefix ?? null,
      legacy_sheet_id: p.sheetId || null,
    })
    if (error) throw new Error(`createProject: ${error.message}`)

    // 劇集：建好 ep01~epN 的 episodes
    if (p.type === 'series' && p.episodeCount && p.episodePrefix) {
      const rows = Array.from({ length: p.episodeCount }, (_, i) => ({
        project_id: p.id,
        ep_key: `${p.episodePrefix}${String(i + 1).padStart(2, '0')}`,
        display_order: i + 1,
      }))
      const { error: epErr } = await this.client.from('episodes').insert(rows)
      if (epErr) throw new Error(`createProject episodes: ${epErr.message}`)
    } else if (p.type === 'film') {
      const { error: epErr } = await this.client
        .from('episodes')
        .insert({ project_id: p.id, ep_key: 'Scenes', display_order: 1 })
      if (epErr) throw new Error(`createProject film episode: ${epErr.message}`)
    }
  }

  async createProjectSheet(_p: ProjectConfig): Promise<CreateSheetResult> {
    // Supabase 沒有「建 Google Sheet」概念；此方法在 Supabase 世界是 no-op
    return { sheetId: '', movedToFolder: false, sheetUrl: '' }
  }

  async updateProject(p: ProjectConfig): Promise<void> {
    const { error } = await this.client
      .from('projects')
      .update({
        name: p.name,
        type: p.type,
        episode_count: p.episodeCount ?? null,
        episode_prefix: p.episodePrefix ?? null,
        legacy_sheet_id: p.sheetId || null,
      })
      .eq('id', p.id)
    if (error) throw new Error(`updateProject: ${error.message}`)
  }

  async deleteProject(id: string): Promise<void> {
    // ON DELETE CASCADE 會帶走 episodes / scenes / episode_meta
    const { error } = await this.client.from('projects').delete().eq('id', id)
    if (error) throw new Error(`deleteProject: ${error.message}`)
  }

  // ============================================================
  // scenes（讀）
  // ============================================================

  async fetchEpisode(project: ProjectConfig, ep: string): Promise<SceneRow[]> {
    const epId = await this.getEpisodeId(project.id, ep)
    const { data, error } = await this.client
      .from('scenes')
      .select('*')
      .eq('episode_id', epId)
      .order('row_order')
    if (error) throw new Error(`fetchEpisode: ${error.message}`)
    return (data ?? []).map(dbToSceneRow)
  }

  async fetchEpisodesBatch(
    project: ProjectConfig,
    eps: string[],
  ): Promise<Record<string, SceneRow[]>> {
    if (eps.length === 0) return {}
    // 一次 join 查完（不要每集各 round-trip）
    const { data: epRows, error: epErr } = await this.client
      .from('episodes')
      .select('id, ep_key')
      .eq('project_id', project.id)
      .in('ep_key', eps)
    if (epErr) throw new Error(`fetchEpisodesBatch: ${epErr.message}`)

    const epIdToKey = new Map((epRows ?? []).map(r => [r.id, r.ep_key]))
    const epIds = (epRows ?? []).map(r => r.id)
    const out: Record<string, SceneRow[]> = {}
    eps.forEach(k => (out[k] = []))

    if (epIds.length === 0) return out

    const { data: sceneRows, error: scErr } = await this.client
      .from('scenes')
      .select('*')
      .in('episode_id', epIds)
      .order('row_order')
    if (scErr) throw new Error(`fetchEpisodesBatch scenes: ${scErr.message}`)

    for (const s of (sceneRows ?? []) as DbScene[]) {
      const key = epIdToKey.get(s.episode_id)
      if (key) out[key].push(dbToSceneRow(s))
    }
    return out
  }

  // ============================================================
  // scenes（寫）
  // ============================================================

  async updateScene(
    project: ProjectConfig, ep: string, rowIndex: number, scene: SceneRow,
  ): Promise<void> {
    const epId = await this.getEpisodeId(project.id, ep)
    const row = sceneRowToDb(scene, epId, rowIndex + 1)
    const { error } = await this.client
      .from('scenes')
      .upsert(row, { onConflict: 'episode_id,scene_key' })
    if (error) throw new Error(`updateScene: ${error.message}`)
  }

  async appendScene(project: ProjectConfig, ep: string, scene: SceneRow): Promise<void> {
    const epId = await this.getEpisodeId(project.id, ep)
    // 找目前最大的 row_order 放最後
    const { data: maxRow } = await this.client
      .from('scenes')
      .select('row_order')
      .eq('episode_id', epId)
      .order('row_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = (maxRow?.row_order ?? 0) + 1
    const row = sceneRowToDb(scene, epId, nextOrder)
    const { error } = await this.client
      .from('scenes')
      .upsert(row, { onConflict: 'episode_id,scene_key' })
    if (error) throw new Error(`appendScene: ${error.message}`)
  }

  async batchUpdateScenes(
    project: ProjectConfig,
    ep: string,
    updates: { rowIndex: number; scene: SceneRow }[],
  ): Promise<void> {
    if (updates.length === 0) return
    const epId = await this.getEpisodeId(project.id, ep)
    const rows = updates.map(u => sceneRowToDb(u.scene, epId, u.rowIndex + 1))
    const { error } = await this.client
      .from('scenes')
      .upsert(rows, { onConflict: 'episode_id,scene_key' })
    if (error) throw new Error(`batchUpdateScenes: ${error.message}`)
  }

  async deleteScene(project: ProjectConfig, ep: string, rowIndex: number): Promise<void> {
    const epId = await this.getEpisodeId(project.id, ep)
    const { data, error } = await this.client
      .from('scenes')
      .select('id, row_order')
      .eq('episode_id', epId)
      .order('row_order')
    if (error) throw new Error(`deleteScene lookup: ${error.message}`)
    const target = (data ?? [])[rowIndex]
    if (!target) throw new Error(`deleteScene: rowIndex ${rowIndex} 超出範圍`)
    const { error: delErr } = await this.client.from('scenes').delete().eq('id', target.id)
    if (delErr) throw new Error(`deleteScene: ${delErr.message}`)
  }

  async batchDeleteScenes(
    project: ProjectConfig, ep: string, rowIndices: number[],
  ): Promise<void> {
    if (rowIndices.length === 0) return
    const epId = await this.getEpisodeId(project.id, ep)
    const { data, error } = await this.client
      .from('scenes')
      .select('id, row_order')
      .eq('episode_id', epId)
      .order('row_order')
    if (error) throw new Error(`batchDeleteScenes lookup: ${error.message}`)
    const rows = data ?? []
    const ids = rowIndices.map(i => rows[i]?.id).filter((x): x is string => !!x)
    if (ids.length === 0) return
    const { error: delErr } = await this.client.from('scenes').delete().in('id', ids)
    if (delErr) throw new Error(`batchDeleteScenes: ${delErr.message}`)
  }

  // ============================================================
  // summary（即時算，不存）
  // ============================================================

  async fetchSummary(project: ProjectConfig): Promise<SummaryRow[]> {
    if (project.type !== 'series' || !project.episodeCount || !project.episodePrefix) return []

    const eps = Array.from({ length: project.episodeCount }, (_, i) =>
      `${project.episodePrefix}${String(i + 1).padStart(2, '0')}`,
    )
    const batch = await this.fetchEpisodesBatch(project, eps)

    return eps.map(ep => {
      const scenes = batch[ep] ?? []
      const st = computeEpisodeStats(scenes)
      return statsToSummaryRow(ep, st)
    })
  }

  async updateSummaryRow(_project: ProjectConfig, _ep: string, _stats: EpisodeStats): Promise<void> {
    // Supabase 不存總覽；即時算，故 no-op
  }

  async batchUpdateSummary(
    _project: ProjectConfig,
    _items: { ep: string; stats: EpisodeStats }[],
  ): Promise<void> {
    // no-op（同 updateSummaryRow）
  }

  // ============================================================
  // episode_meta（K/V 手輸資料，例如精剪總長）
  // ============================================================

  async ensureMetaTab(_project: ProjectConfig): Promise<void> {
    // Supabase 的 episode_meta 表永遠在，不用「建 tab」
  }

  async fetchMeta(project: ProjectConfig): Promise<Record<string, string>> {
    const { data: epRows, error: epErr } = await this.client
      .from('episodes')
      .select('id, ep_key')
      .eq('project_id', project.id)
    if (epErr) throw new Error(`fetchMeta episodes: ${epErr.message}`)
    const idToKey = new Map((epRows ?? []).map(r => [r.id, r.ep_key]))
    const epIds = (epRows ?? []).map(r => r.id)
    if (epIds.length === 0) return {}

    const { data: metaRows, error: mErr } = await this.client
      .from('episode_meta')
      .select('episode_id, key, value')
      .in('episode_id', epIds)
    if (mErr) throw new Error(`fetchMeta: ${mErr.message}`)

    const out: Record<string, string> = {}
    for (const m of metaRows ?? []) {
      const epKey = idToKey.get(m.episode_id as string)
      if (epKey) out[`${epKey}.${m.key}`] = m.value as string
    }
    return out
  }

  async setMeta(project: ProjectConfig, key: string, value: string): Promise<void> {
    // key 格式：`${ep_key}.${subkey}`，例如 `ep01.finecutTotalLength`
    const dot = key.indexOf('.')
    if (dot < 0) throw new Error(`setMeta: key 需為 '{ep}.{name}' 格式，got ${key}`)
    const epKey = key.slice(0, dot)
    const subKey = key.slice(dot + 1)

    const epId = await this.getEpisodeId(project.id, epKey)
    const { error } = await this.client
      .from('episode_meta')
      .upsert({ episode_id: epId, key: subKey, value }, { onConflict: 'episode_id,key' })
    if (error) throw new Error(`setMeta: ${error.message}`)
  }
}

// ---- 內部工具：把 EpisodeStats 轉成 SummaryRow ----

function statsToSummaryRow(ep: string, s: EpisodeStats): SummaryRow {
  const avgPageSecs = s.totalPages > 0 ? Math.round(s.totalSecs / s.totalPages) : 0
  return {
    episode: ep,
    roughcutPct: s.roughcutPct,
    finecutPct: s.finecutPct,
    roughcutDuration: secsToHMS(s.roughcutSecs),
    finecutDuration: secsToHMS(s.finecutSecs),
    totalDuration: secsToHMS(s.totalSecs),
    roughcutScenes: s.roughcutScenes,
    finecutScenes: s.finecutScenes,
    totalScenes: s.totalScenes,
    roughcutPages: s.roughcutPages,
    finecutPages: s.finecutPages,
    avgPageDuration: avgPageSecs ? secsToHMS(avgPageSecs) : '',
  }
}
