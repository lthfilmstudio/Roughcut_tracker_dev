#!/usr/bin/env node
/**
 * Roughcut Tracker — Google Sheets → Supabase 遷移腳本
 *
 * 用法：
 *   cd tracker_dev
 *   node scripts/migrate-to-supabase.mjs --project beicheng
 *   node scripts/migrate-to-supabase.mjs --all  # 遷所有專案
 *
 * 前置條件：
 *   1. scripts/migration-sa-key.local.json（Service Account 金鑰）
 *   2. scripts/.env.migration.local 裡有 SUPABASE_URL + SUPABASE_SERVICE_KEY + META_SHEET_ID
 *   3. SA email 已被共用到 Meta Sheet 和目標專案 Sheet（檢視者即可）
 *
 * 可重跑：使用 upsert（自然鍵衝突時更新，不衝突時插入）。
 *
 * Sheet 結構（對應程式碼 src/services/googleSheetsService.ts）：
 *   Meta Sheet: Projects!A2:H (positional) = id, name, type, passwordHash, sheetId, episodeCount, episodePrefix, createdAt
 *   專案 Sheet:
 *     Tab 1 = 總覽（略過）
 *     Tab 2~N+1 = ep01~N，範圍 !A2:G = 場次, 初剪長度, 頁數, 初剪日期, 狀態, 尚缺鏡頭, 備註
 *     _meta tab = K/V 表，A2:B，key 格式 `{tabTitle}.{屬性}`
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '.env.migration.local') })

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, META_SHEET_ID } = process.env
function must(name, value) {
  if (!value) {
    console.error(`❌ 環境變數 ${name} 沒有設定（檢查 scripts/.env.migration.local）`)
    process.exit(1)
  }
}
must('SUPABASE_URL', SUPABASE_URL)
must('SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY)
must('META_SHEET_ID', META_SHEET_ID)

// ---- CLI args ----
const args = process.argv.slice(2)
const projectFilter = (() => {
  const i = args.indexOf('--project')
  return i >= 0 ? args[i + 1] : null
})()
const migrateAll = args.includes('--all')
if (!projectFilter && !migrateAll) {
  console.error('用法：node migrate-to-supabase.mjs --project <id>  或  --all')
  process.exit(1)
}

// ---- Auth ----
const saKey = JSON.parse(readFileSync(resolve(__dirname, 'migration-sa-key.local.json'), 'utf8'))
const googleAuth = new google.auth.GoogleAuth({
  credentials: saKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheetsApi = google.sheets({ version: 'v4', auth: googleAuth })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---- Helpers ----
function toSecs(hmmss) {
  if (!hmmss || typeof hmmss !== 'string') return null
  const m = hmmss.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
function parsePages(val) {
  if (val === '' || val == null) return null
  const n = Number(String(val).trim())
  return Number.isFinite(n) ? n : null
}
function parseDate(val) {
  if (!val) return null
  const m = String(val).trim().match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}
function parseStatus(val) {
  const s = (val || '').trim()
  return (s === '已初剪' || s === '已精剪' || s === '整場刪除') ? s : null
}
function parseFlag(val) {
  const s = (val || '').trim()
  return !!s && s !== '否' && s !== 'false' && s !== '0'
}

// ---- Step 1: 讀 Meta Sheet ----
async function fetchProjects() {
  console.log('📖 讀取 Meta Sheet（Projects!A2:H）...')
  const resp = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: META_SHEET_ID,
    range: 'Projects!A2:H',
  })
  const rows = resp.data.values || []
  const projects = rows
    .filter(r => r[0] && r[1] && r[4]) // id, name, sheetId 必要
    .map(r => ({
      id: r[0],
      name: r[1],
      type: r[2] || 'series',
      sheetId: r[4],
      episodeCount: r[5] ? parseInt(r[5], 10) : null,
      episodePrefix: r[6] || null,
    }))
  console.log(`   找到 ${projects.length} 個專案：${projects.map(p => p.id).join(', ')}`)
  return projects
}

// ---- Step 2: upsert project ----
async function upsertProject(p) {
  const { error } = await supabase.from('projects').upsert({
    id: p.id,
    name: p.name,
    type: p.type,
    episode_count: p.episodeCount,
    episode_prefix: p.episodePrefix,
    legacy_sheet_id: p.sheetId,
  }, { onConflict: 'id' })
  if (error) throw new Error(`upsert project ${p.id} 失敗：${error.message}`)
}

// ---- Step 3: 專案 Sheet 的 tab 結構 ----
async function fetchProjectTabs(sheetId) {
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties(title,sheetId,index)',
  })
  return (meta.data.sheets || []).map(s => s.properties).sort((a, b) => a.index - b.index)
}

// ---- Step 4: 讀專案 _meta tab（K/V） ----
async function fetchProjectMeta(sheetId) {
  try {
    const resp = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: '_meta!A2:B',
    })
    const rows = resp.data.values || []
    const out = {}
    for (const r of rows) {
      if (r[0]) out[r[0]] = r[1] ?? ''
    }
    return out
  } catch (e) {
    if (String(e.message || '').includes('Unable to parse range')) return {}
    throw e
  }
}

// ---- Step 5: 遷移單一專案 ----
async function migrateProject(p) {
  console.log(`\n🎬 遷移專案：${p.id}（${p.name}）`)
  await upsertProject(p)

  const tabs = await fetchProjectTabs(p.sheetId)
  // 劇集：Tab 0 = 總覽，跳過；Tab 1+ = ep01~epN
  // 電影：沒有總覽，第 1 個 tab 就是 Scenes
  // 兩種都要排除 `_` 開頭（例如 _meta）
  const episodeTabs = tabs.filter((t, i) => {
    if (t.title.startsWith('_')) return false
    if (p.type === 'series' && i === 0) return false
    return true
  })
  const metaFlat = await fetchProjectMeta(p.sheetId)

  console.log(`   episode tabs: ${episodeTabs.map(t => t.title).join(', ')}`)
  if (Object.keys(metaFlat).length > 0) {
    console.log(`   _meta keys: ${Object.keys(metaFlat).length} 筆`)
  }

  let totalScenes = 0

  for (let i = 0; i < episodeTabs.length; i++) {
    const tab = episodeTabs[i]
    const epKey = p.type === 'series'
      ? `${p.episodePrefix || 'ep'}${String(i + 1).padStart(2, '0')}`
      : 'Scenes'

    // upsert episode
    const { data: epData, error: epErr } = await supabase
      .from('episodes')
      .upsert(
        { project_id: p.id, ep_key: epKey, display_order: i + 1 },
        { onConflict: 'project_id,ep_key' },
      )
      .select('id')
      .single()
    if (epErr) throw new Error(`upsert episode ${p.id}/${epKey}：${epErr.message}`)
    const episodeId = epData.id

    // read scenes from tab using its actual tab title
    const scenesResp = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: p.sheetId,
      range: `'${tab.title}'!A2:G`,
    })
    const sceneRaw = scenesResp.data.values || []
    const sceneRows = sceneRaw
      .filter(r => r[0]) // 必須有場次號
      .map((r, idx) => ({
        episode_id: episodeId,
        scene_key: (r[0] || '').trim(),
        roughcut_length_secs: toSecs(r[1]),
        pages: parsePages(r[2]),
        roughcut_date: parseDate(r[3]),
        status: parseStatus(r[4]),
        missing_shots: parseFlag(r[5]),
        notes: (r[6] || '').trim() || null,
        row_order: idx + 1,
      }))

    if (sceneRows.length > 0) {
      const { error: scErr } = await supabase
        .from('scenes')
        .upsert(sceneRows, { onConflict: 'episode_id,scene_key' })
      if (scErr) throw new Error(`upsert scenes ${epKey}：${scErr.message}`)
      totalScenes += sceneRows.length
    }

    // 把 {tab.title}.* 的 meta 寫進 episode_meta
    const prefix = `${tab.title}.`
    const metaRows = Object.entries(metaFlat)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({
        episode_id: episodeId,
        key: k.slice(prefix.length),
        value: String(v),
      }))

    if (metaRows.length > 0) {
      const { error: mErr } = await supabase
        .from('episode_meta')
        .upsert(metaRows, { onConflict: 'episode_id,key' })
      if (mErr) throw new Error(`upsert meta ${epKey}：${mErr.message}`)
    }

    console.log(`   [${epKey}] scenes=${sceneRows.length}${metaRows.length ? `, meta=${metaRows.length}` : ''}`)
  }

  console.log(`   ✅ 專案 ${p.id} 完成：${totalScenes} 個場次`)
}

// ---- Main ----
async function main() {
  const allProjects = await fetchProjects()
  const targets = migrateAll
    ? allProjects
    : allProjects.filter(p => p.id === projectFilter)

  if (targets.length === 0) {
    console.error(`❌ 找不到專案：${projectFilter}`)
    console.error(`   可用：${allProjects.map(p => p.id).join(', ')}`)
    process.exit(1)
  }

  for (const p of targets) {
    await migrateProject(p)
  }

  console.log('\n🎉 遷移完成！')
  console.log('   Supabase Table Editor：')
  console.log('   https://supabase.com/dashboard/project/ntxqnvgpvshqwodagupt/editor')
}

main().catch(err => {
  console.error('\n❌ 遷移失敗：', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'))
  process.exit(1)
})
