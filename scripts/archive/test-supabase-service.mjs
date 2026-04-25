#!/usr/bin/env node
/**
 * Smoke test SupabaseService 的讀寫邏輯。
 * 因為 SupabaseService 的 TS 檔用了 Vite 的 import.meta.env，
 * 這裡我們不 import 它，而是用 raw supabase-js 手動模擬幾個關鍵操作。
 *
 * 更完整的整合測試留到 SupabaseService 真的接上前端時一起做（preview 頁 + npm run dev）。
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(__dirname, '.env.migration.local') })

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function secsToHMS(s) {
  if (s == null) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

let failed = 0
async function test(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`✗ ${name}: ${e.message}`)
  }
}

// -------------------------------------------------------------

await test('getProjects 回傳北城', async () => {
  const { data, error } = await sb.from('projects').select('*').eq('id', 'beicheng').single()
  if (error) throw error
  if (data.name !== '北城百畫帖') throw new Error('name 錯了')
  if (data.type !== 'series') throw new Error('type 錯了')
  if (data.episode_count !== 12) throw new Error('episode_count 錯了')
})

await test('fetchEpisodesBatch 結構正確', async () => {
  const { data: eps } = await sb.from('episodes').select('id, ep_key').eq('project_id', 'beicheng').in('ep_key', ['ep01', 'ep02'])
  if (!eps || eps.length !== 2) throw new Error('找不到 ep01/ep02')
  const { data: scenes } = await sb.from('scenes').select('*').in('episode_id', eps.map(e => e.id)).order('row_order')
  if (!scenes || scenes.length < 50) throw new Error(`scenes 數量異常：${scenes?.length}`)
})

await test('length 秒數 → HMS 格式正確', async () => {
  // 秒數 95 應轉為 '0:01:35'
  if (secsToHMS(95) !== '0:01:35') throw new Error(`got ${secsToHMS(95)}`)
  if (secsToHMS(3661) !== '1:01:01') throw new Error(`got ${secsToHMS(3661)}`)
  if (secsToHMS(null) !== '') throw new Error('null 應為空字串')
})

await test('date YYYY-MM-DD → YYYY/MM/DD', async () => {
  const input = '2026-04-15'
  const output = input.replaceAll('-', '/')
  if (output !== '2026/04/15') throw new Error(`got ${output}`)
})

// 建立測試 episode + scene，驗 upsert 可重跑
const TEST_PROJECT = 'beicheng' // 借用，反正之後會清
let testEpId = null

await test('建臨時 test episode（ep99）', async () => {
  const { data, error } = await sb.from('episodes').upsert(
    { project_id: TEST_PROJECT, ep_key: 'ep99_smoke', display_order: 999 },
    { onConflict: 'project_id,ep_key' },
  ).select('id').single()
  if (error) throw error
  testEpId = data.id
})

await test('upsert scene 到 test ep（第一次 insert）', async () => {
  const { error } = await sb.from('scenes').upsert(
    {
      episode_id: testEpId,
      scene_key: 'smoke1',
      roughcut_length_secs: 65,
      pages: 0.5,
      roughcut_date: '2026-04-23',
      status: '已初剪',
      missing_shots: false,
      notes: 'smoke test',
      row_order: 1,
    },
    { onConflict: 'episode_id,scene_key' },
  )
  if (error) throw error
})

await test('upsert scene 第二次（應 update 不重複）', async () => {
  const { error } = await sb.from('scenes').upsert(
    {
      episode_id: testEpId,
      scene_key: 'smoke1',
      roughcut_length_secs: 120, // 改成 2 分鐘
      pages: 0.8,
      roughcut_date: '2026-04-23',
      status: '已精剪',
      missing_shots: true,
      notes: 'smoke test updated',
      row_order: 1,
    },
    { onConflict: 'episode_id,scene_key' },
  )
  if (error) throw error
  const { data, error: qErr } = await sb
    .from('scenes')
    .select('roughcut_length_secs, status, missing_shots')
    .eq('episode_id', testEpId)
    .eq('scene_key', 'smoke1')
    .single()
  if (qErr) throw qErr
  if (data.roughcut_length_secs !== 120) throw new Error(`length 沒更新: ${data.roughcut_length_secs}`)
  if (data.status !== '已精剪') throw new Error(`status 沒更新: ${data.status}`)
  if (data.missing_shots !== true) throw new Error(`missing_shots 沒更新`)
})

await test('清掉 test episode（cascade 帶走 scene）', async () => {
  const { error } = await sb.from('episodes').delete().eq('id', testEpId)
  if (error) throw error
  const { count } = await sb.from('scenes').select('*', { count: 'exact', head: true }).eq('episode_id', testEpId)
  if (count !== 0) throw new Error(`cascade 失敗，還剩 ${count}`)
})

// 驗證清乾淨沒影響北城本體
await test('北城資料完整（12 集、459 場未被動到）', async () => {
  const { count: epC } = await sb.from('episodes').select('*', { count: 'exact', head: true }).eq('project_id', 'beicheng')
  const { count: scC } = await sb
    .from('scenes')
    .select('*, episodes!inner(project_id)', { count: 'exact', head: true })
    .eq('episodes.project_id', 'beicheng')
  if (epC !== 12) throw new Error(`episodes=${epC}`)
  if (scC !== 459) throw new Error(`scenes=${scC}`)
})

// -------------------------------------------------------------

console.log(`\n${failed === 0 ? '🎉 全部通過' : `❌ ${failed} 個失敗`}`)
process.exit(failed > 0 ? 1 : 0)
