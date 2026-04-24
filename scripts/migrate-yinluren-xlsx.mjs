#!/usr/bin/env node
/**
 * 引路人 xlsx → Supabase 重匯入（覆蓋現有 wayfinder scenes）
 *
 * 用法：
 *   cd tracker_dev
 *   node scripts/migrate-yinluren-xlsx.mjs
 *
 * 前置：
 *   1. xlsx 已分享給 SA（roughcut-migration@roughcut-tracker.iam.gserviceaccount.com）
 *   2. scripts/.env.migration.local 有 SUPABASE_URL + SUPABASE_SERVICE_KEY
 *   3. scripts/migration-sa-key.local.json 存在
 *
 * 特點：
 *   - 解析 MM:SS 長度格式（xlsx 無時數）
 *   - 解析 M/D 日期格式（預設 2026 年）
 *   - 無狀態欄 → status = null
 *   - 保留 episode row 和 episode_meta（finecut 總長 2:29:25）
 *   - 先 DELETE 所有 wayfinder scenes 再重新 INSERT
 *
 * 欄位對應（xlsx 長度表 7 欄）：
 *   A 場        → scene_key
 *   B 完整長度  → roughcut_length_secs (MM:SS)
 *   C 缺鏡長度  → 忽略（此 xlsx 全空）
 *   D 頁數      → pages
 *   E 日期      → roughcut_date (M/D，補 2026 年)
 *   F 備註      → notes（若 G 有值，附加「｜尚缺：X」）
 *   G 尚缺鏡頭  → missing_shots (boolean = G 非空)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '.env.migration.local') })

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺 SUPABASE_URL / SUPABASE_SERVICE_KEY（scripts/.env.migration.local）')
  process.exit(1)
}

const XLSX_FILE_ID = '14RW11ZeQjZXJedEkLtunbjm-fAMYPvG8'
const PROJECT_ID   = 'wayfinder'
const EP_KEY       = 'Scenes'
const TAB_NAME     = '長度表'
const DEFAULT_YEAR = 2026

// ---- Auth ----
const saKey = JSON.parse(readFileSync(resolve(__dirname, 'migration-sa-key.local.json'), 'utf8'))
const googleAuth = new google.auth.GoogleAuth({
  credentials: saKey,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
})
const authClient = await googleAuth.getClient()
const drive = google.drive({ version: 'v3', auth: authClient })

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---- Parsers ----
function parseMmss(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number') {
    // Excel 時間以天為單位的小數，轉秒
    return Math.round(val * 86400)
  }
  const s = String(val).trim()
  let m = s.match(/^(\d+):(\d{2}):(\d{2})$/)
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  m = s.match(/^(\d+):(\d{2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return null
}

function parsePages(val) {
  if (val == null || val === '') return null
  const n = Number(String(val).trim())
  return Number.isFinite(n) ? n : null
}

function parseDateMD(val, year = DEFAULT_YEAR) {
  if (val == null || val === '') return null
  if (val instanceof Date && !isNaN(val)) {
    return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`
  }
  const s = String(val).trim()
  let m = s.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m) return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

function buildNotes(notesRaw, missingRaw) {
  const base = notesRaw ? String(notesRaw).trim() : ''
  const ms   = missingRaw ? String(missingRaw).trim() : ''
  if (base && ms) return `${base}｜尚缺：${ms}`
  if (ms) return `尚缺：${ms}`
  return base || null
}

// ---- Main ----
async function main() {
  console.log(`\n⬇️  下載 xlsx：${XLSX_FILE_ID}`)
  const dl = await drive.files.get(
    { fileId: XLSX_FILE_ID, alt: 'media' },
    { responseType: 'arraybuffer' },
  )
  const buffer = Buffer.from(dl.data)
  console.log(`   下載成功（${buffer.length} bytes）`)

  console.log(`\n📖 解析 "${TAB_NAME}" 分頁`)
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  if (!wb.Sheets[TAB_NAME]) {
    console.error(`❌ 找不到分頁 "${TAB_NAME}"。可用分頁：${wb.SheetNames.join(', ')}`)
    process.exit(1)
  }
  // raw:false → 所有格都用顯示字串返回（日期、時間都變字串）
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[TAB_NAME], {
    header: 1, blankrows: false, defval: null, raw: false,
  })
  console.log(`   原始列數（含標題）：${rows.length}`)
  console.log(`   標題列：${JSON.stringify(rows[0])}`)

  // 跳過標題 + total 列
  const dataRows = rows.slice(1).filter(r => {
    const key = r[0] != null ? String(r[0]).trim() : ''
    return key !== '' && key.toLowerCase() !== 'total'
  })
  console.log(`   實際場次列：${dataRows.length}`)

  const scenes = dataRows.map((r, idx) => {
    const [sceneKey, lengthRaw, /* missingLen */, pagesRaw, dateRaw, notes, missingShots] = r
    return {
      scene_key: String(sceneKey).trim(),
      roughcut_length_secs: parseMmss(lengthRaw),
      pages: parsePages(pagesRaw),
      roughcut_date: parseDateMD(dateRaw),
      status: null,
      missing_shots: !!(missingShots != null && String(missingShots).trim() !== ''),
      notes: buildNotes(notes, missingShots),
      row_order: idx + 1,
    }
  })

  // 查 episode_id
  console.log(`\n🔍 查找 ${PROJECT_ID}/${EP_KEY} episode`)
  const { data: epRow, error: epErr } = await supabase
    .from('episodes')
    .select('id')
    .eq('project_id', PROJECT_ID)
    .eq('ep_key', EP_KEY)
    .maybeSingle()
  if (epErr) throw new Error(`查 episode 失敗：${epErr.message}`)
  if (!epRow) throw new Error(`找不到 ${PROJECT_ID}/${EP_KEY} episode`)
  const episodeId = epRow.id
  console.log(`   episode_id = ${episodeId}`)

  // 刪除現有場次
  console.log(`\n🗑  清空現有 ${PROJECT_ID} scenes`)
  const { error: delErr, count } = await supabase
    .from('scenes').delete({ count: 'exact' }).eq('episode_id', episodeId)
  if (delErr) throw new Error(`delete scenes 失敗：${delErr.message}`)
  console.log(`   已刪除 ${count ?? '?'} 列`)

  // 插入新場次
  console.log(`\n📝 插入 ${scenes.length} 個新場次`)
  const rowsToInsert = scenes.map(s => ({ ...s, episode_id: episodeId }))
  // 分批，避免 payload 太大
  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const chunk = rowsToInsert.slice(i, i + BATCH)
    const { error: insErr } = await supabase.from('scenes').insert(chunk)
    if (insErr) throw new Error(`insert scenes 失敗（batch ${i}）：${insErr.message}`)
    inserted += chunk.length
    process.stdout.write(`   ${inserted}/${rowsToInsert.length}\r`)
  }
  console.log()

  console.log(`\n✅ 完成。引路人 wayfinder 現在有 ${scenes.length} 個場次。`)
  console.log(`   episode_meta（finecut 總長）未動。`)
}

main().catch(e => {
  console.error('\n❌ 失敗：', e.message || e)
  process.exit(1)
})
