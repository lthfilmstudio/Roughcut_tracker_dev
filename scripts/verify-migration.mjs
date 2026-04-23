#!/usr/bin/env node
/**
 * 驗證遷移結果：count 每張表、spot check 一個場次
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

async function count(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  return count
}

async function main() {
  console.log('📊 Table counts:')
  for (const t of ['projects', 'episodes', 'scenes', 'episode_meta']) {
    console.log(`   ${t.padEnd(15)} ${await count(t)}`)
  }

  console.log('\n🔍 Spot check — beicheng ep01 前 3 個場次:')
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .select('id, ep_key, project_id')
    .eq('project_id', 'beicheng')
    .eq('ep_key', 'ep01')
    .single()
  if (epErr) throw epErr

  const { data: scenes, error: scErr } = await supabase
    .from('scenes')
    .select('scene_key, roughcut_length_secs, pages, status, missing_shots, row_order')
    .eq('episode_id', ep.id)
    .order('row_order')
    .limit(3)
  if (scErr) throw scErr

  console.table(scenes)

  console.log('\n🔍 狀態分佈（beicheng 全部）:')
  const { data: byStatus } = await supabase.rpc('_nonexistent_just_skip_this')
  // 用手動統計吧
  const { data: allScenes } = await supabase
    .from('scenes')
    .select('status, episodes!inner(project_id)')
    .eq('episodes.project_id', 'beicheng')

  const counts = {}
  for (const s of allScenes || []) counts[s.status || '(空)'] = (counts[s.status || '(空)'] || 0) + 1
  console.table(counts)
}

main().catch(e => { console.error(e.message); process.exit(1) })
