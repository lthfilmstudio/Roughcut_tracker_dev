#!/usr/bin/env node
/**
 * 挑一些有資料的場次驗證（確認 length/status/date 都有正確轉換）
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

function secsToHMS(s) {
  if (s == null) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const { data: eps } = await supabase
  .from('episodes').select('id, ep_key').eq('project_id', 'beicheng').order('ep_key')

console.log('📋 每集已初剪統計：')
for (const ep of eps) {
  const { data: cut } = await supabase
    .from('scenes')
    .select('scene_key, roughcut_length_secs, status, roughcut_date')
    .eq('episode_id', ep.id)
    .eq('status', '已初剪')
    .not('roughcut_length_secs', 'is', null)
    .order('row_order')
    .limit(3)

  const { count } = await supabase
    .from('scenes')
    .select('*', { count: 'exact', head: true })
    .eq('episode_id', ep.id)
    .eq('status', '已初剪')

  console.log(`\n${ep.ep_key}: ${count} 場已初剪`)
  if (cut.length > 0) {
    cut.forEach(s => {
      console.log(`   場 ${s.scene_key}: ${secsToHMS(s.roughcut_length_secs)} | ${s.roughcut_date || '—'}`)
    })
  }
}
