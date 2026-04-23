#!/usr/bin/env node
/**
 * 灌測試資料給 cestlavie（劇集）和 ghost-company（電影）
 * 上游前提：projects 表已有這兩筆（已手動在 Studio 建好）
 *
 * 資料說明：
 *   - cestlavie：8 集，每集 5~8 個場次，狀態分佈逼真
 *   - ghost-company：一個 Scenes tab，12 個場次
 *
 * 使用 service_role key bypass RLS。可重跑（upsert）。
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '.env.migration.local') })

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---- 假資料樣本 ----
function hmsToSecs(h, m, s) { return h * 3600 + m * 60 + s }

// cestlavie: 8 集，每集的場次資料
const cestlavieEpisodes = [
  {
    ep_key: 'ep01', display_order: 1,
    scenes: [
      { scene_key: '1',   len: hmsToSecs(0, 1, 45), pages: 1.2, date: '2026-04-01', status: '已初剪', missing: false, notes: '' },
      { scene_key: '2',   len: hmsToSecs(0, 3, 12), pages: 2.0, date: '2026-04-01', status: '已初剪', missing: false, notes: '' },
      { scene_key: '2A',  len: hmsToSecs(0, 0, 45), pages: 0.3, date: '2026-04-02', status: '已初剪', missing: true,  notes: '需補特寫' },
      { scene_key: '3',   len: hmsToSecs(0, 2, 30), pages: 1.5, date: '2026-04-02', status: '已精剪', missing: false, notes: '' },
      { scene_key: '4',   len: null,                pages: 1.0, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '5',   len: hmsToSecs(0, 1, 18), pages: 0.8, date: '2026-04-03', status: '已初剪', missing: false, notes: '' },
      { scene_key: '6',   len: null,                pages: null, date: null,         status: '整場刪除', missing: false, notes: '導演決定拿掉' },
    ],
  },
  {
    ep_key: 'ep02', display_order: 2,
    scenes: [
      { scene_key: '1',   len: hmsToSecs(0, 2, 0),  pages: 1.5, date: '2026-04-05', status: '已初剪', missing: false, notes: '' },
      { scene_key: '2',   len: hmsToSecs(0, 1, 30), pages: 1.0, date: '2026-04-05', status: '已初剪', missing: false, notes: '' },
      { scene_key: '3',   len: hmsToSecs(0, 4, 20), pages: 2.8, date: '2026-04-06', status: '已初剪', missing: false, notes: '' },
      { scene_key: '4ins',len: hmsToSecs(0, 0, 15), pages: 0.1, date: '2026-04-06', status: '已初剪', missing: false, notes: '插入鏡頭' },
      { scene_key: '5',   len: hmsToSecs(0, 2, 45), pages: 1.8, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '6',   len: null,                pages: 1.2, date: null,         status: null,      missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep03', display_order: 3,
    scenes: [
      { scene_key: '1',   len: hmsToSecs(0, 3, 0),  pages: 2.0, date: '2026-04-08', status: '已初剪', missing: false, notes: '' },
      { scene_key: '2',   len: hmsToSecs(0, 1, 22), pages: 0.9, date: '2026-04-08', status: '已初剪', missing: true,  notes: '缺 cutaway' },
      { scene_key: '3',   len: hmsToSecs(0, 2, 10), pages: 1.3, date: '2026-04-09', status: '已初剪', missing: false, notes: '' },
      { scene_key: '4',   len: null,                pages: 1.5, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '5',   len: null,                pages: 2.0, date: null,         status: null,      missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep04', display_order: 4,
    scenes: [
      { scene_key: '1',   len: hmsToSecs(0, 2, 35), pages: 1.7, date: '2026-04-12', status: '已初剪', missing: false, notes: '' },
      { scene_key: '2',   len: hmsToSecs(0, 0, 55), pages: 0.6, date: '2026-04-12', status: '已初剪', missing: false, notes: '' },
      { scene_key: '3',   len: null,                pages: 1.0, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '4',   len: null,                pages: 1.8, date: null,         status: null,      missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep05', display_order: 5,
    scenes: [
      { scene_key: '1',   len: null,                pages: 1.5, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '2',   len: null,                pages: 2.0, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '3',   len: null,                pages: 1.2, date: null,         status: null,      missing: false, notes: '' },
      { scene_key: '4',   len: null,                pages: 1.0, date: null,         status: null,      missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep06', display_order: 6,
    scenes: [
      { scene_key: '1',   len: null, pages: 1.8, date: null, status: null, missing: false, notes: '' },
      { scene_key: '2',   len: null, pages: 1.3, date: null, status: null, missing: false, notes: '' },
      { scene_key: '3',   len: null, pages: 0.9, date: null, status: null, missing: false, notes: '' },
      { scene_key: '4',   len: null, pages: 2.2, date: null, status: null, missing: false, notes: '' },
      { scene_key: '5',   len: null, pages: 1.5, date: null, status: null, missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep07', display_order: 7,
    scenes: [
      { scene_key: '1',   len: null, pages: 1.0, date: null, status: null, missing: false, notes: '' },
      { scene_key: '2',   len: null, pages: 1.5, date: null, status: null, missing: false, notes: '' },
      { scene_key: '3',   len: null, pages: 2.3, date: null, status: null, missing: false, notes: '' },
    ],
  },
  {
    ep_key: 'ep08', display_order: 8,
    scenes: [
      { scene_key: '1',   len: null, pages: 1.8, date: null, status: null, missing: false, notes: '大結局' },
      { scene_key: '2',   len: null, pages: 2.0, date: null, status: null, missing: false, notes: '' },
      { scene_key: '3',   len: null, pages: 1.4, date: null, status: null, missing: false, notes: '' },
      { scene_key: '4',   len: null, pages: 3.2, date: null, status: null, missing: false, notes: '結尾長場' },
    ],
  },
]

// ghost-company: 電影，一個 Scenes tab
const ghostScenes = [
  { scene_key: '1',   len: hmsToSecs(0, 1, 22), pages: 0.8, date: '2026-04-10', status: '已初剪', missing: false, notes: '開場' },
  { scene_key: '2',   len: hmsToSecs(0, 0, 45), pages: 0.5, date: '2026-04-10', status: '已初剪', missing: false, notes: '' },
  { scene_key: '3',   len: hmsToSecs(0, 3, 10), pages: 2.0, date: '2026-04-11', status: '已初剪', missing: false, notes: '' },
  { scene_key: '3A',  len: hmsToSecs(0, 0, 30), pages: 0.2, date: '2026-04-11', status: '已初剪', missing: true,  notes: '缺表情特寫' },
  { scene_key: '4',   len: hmsToSecs(0, 2, 0),  pages: 1.5, date: '2026-04-12', status: '已初剪', missing: false, notes: '' },
  { scene_key: '5',   len: hmsToSecs(0, 4, 30), pages: 3.0, date: '2026-04-13', status: '已精剪', missing: false, notes: '關鍵對白場' },
  { scene_key: '5ins',len: hmsToSecs(0, 0, 10), pages: 0.1, date: '2026-04-13', status: '已初剪', missing: false, notes: '' },
  { scene_key: '6',   len: null,                pages: 1.8, date: null,         status: null,      missing: false, notes: '' },
  { scene_key: '7',   len: null,                pages: null, date: null,         status: '整場刪除', missing: false, notes: '劇本刪除' },
  { scene_key: '8',   len: null,                pages: 2.2, date: null,         status: null,      missing: false, notes: '' },
  { scene_key: '9',   len: null,                pages: 1.4, date: null,         status: null,      missing: false, notes: '' },
  { scene_key: '10',  len: null,                pages: 2.0, date: null,         status: null,      missing: false, notes: '結尾' },
]

// ---- 寫入邏輯 ----

async function upsertEpisode(projectId, epKey, displayOrder) {
  const { data, error } = await supabase
    .from('episodes')
    .upsert({ project_id: projectId, ep_key: epKey, display_order: displayOrder }, { onConflict: 'project_id,ep_key' })
    .select('id')
    .single()
  if (error) throw new Error(`upsert episode ${projectId}/${epKey}: ${error.message}`)
  return data.id
}

async function upsertScenes(episodeId, scenes) {
  if (scenes.length === 0) return
  const rows = scenes.map((s, idx) => ({
    episode_id: episodeId,
    scene_key: s.scene_key,
    roughcut_length_secs: s.len,
    pages: s.pages,
    roughcut_date: s.date,
    status: s.status,
    missing_shots: s.missing,
    notes: s.notes || null,
    row_order: idx + 1,
  }))
  const { error } = await supabase.from('scenes').upsert(rows, { onConflict: 'episode_id,scene_key' })
  if (error) throw new Error(`upsert scenes for ${episodeId}: ${error.message}`)
}

async function main() {
  // 確認專案存在
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, type')
    .in('id', ['cestlavie', 'ghost-company'])
  if (pErr) throw pErr
  console.log('找到專案:', projects.map(p => `${p.id}(${p.name}, ${p.type})`).join(', '))
  if (projects.length !== 2) {
    console.error('❌ 請先在 Studio 建好 cestlavie 和 ghost-company 兩個 project')
    process.exit(1)
  }

  // cestlavie
  console.log('\n🎬 灌 cestlavie（即興生活）...')
  for (const ep of cestlavieEpisodes) {
    const epId = await upsertEpisode('cestlavie', ep.ep_key, ep.display_order)
    await upsertScenes(epId, ep.scenes)
    console.log(`   ${ep.ep_key}: ${ep.scenes.length} 個場次 ✓`)
  }

  // ghost-company
  console.log('\n🎬 灌 ghost-company（搞什麼鬼公司）...')
  const ghostEpId = await upsertEpisode('ghost-company', 'Scenes', 1)
  await upsertScenes(ghostEpId, ghostScenes)
  console.log(`   Scenes: ${ghostScenes.length} 個場次 ✓`)

  // Summary
  const totalCestlavie = cestlavieEpisodes.reduce((sum, ep) => sum + ep.scenes.length, 0)
  console.log(`\n🎉 完成！cestlavie ${totalCestlavie} 個、ghost-company ${ghostScenes.length} 個場次`)
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
