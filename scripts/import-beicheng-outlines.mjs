#!/usr/bin/env node
/**
 * Import scene outlines from the Beicheng script breakdown CSV.
 *
 * Dry-run by default:
 *   node scripts/import-beicheng-outlines.mjs
 *
 * Apply after reviewing the dry-run:
 *   node scripts/import-beicheng-outlines.mjs --apply
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CSV_PATH = '/Users/lth/Desktop/《北城百畫帖》-EP01-12順場表 0403 - 《北城百畫帖》順場表.csv'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const csvPath = valueAfter('--csv') ?? DEFAULT_CSV_PATH
const projectId = valueAfter('--project') ?? 'beicheng'
const episodePrefix = valueAfter('--episode-prefix') ?? 'ep'

loadEnv()

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env
must('SUPABASE_URL', SUPABASE_URL)
must('SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY)

if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function valueAfter(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

function loadEnv() {
  const candidates = [
    resolve(__dirname, '.env.migration.local'),
    resolve(__dirname, 'archive/.env.migration.local'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path })
      return
    }
  }
}

function must(name, value) {
  if (!value) {
    console.error(`Missing env var: ${name}`)
    process.exit(1)
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}

function cleanCell(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim()
}

function epKeyFromRaw(value) {
  const n = Number.parseInt(cleanCell(value), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${episodePrefix}${String(n).padStart(2, '0')}`
}

function addSource(map, item) {
  const key = `${item.epKey}\t${item.sceneKey}`
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...item, outlines: [item.outline], sourceRows: [item.csvRow] })
    return
  }
  existing.sourceRows.push(item.csvRow)
  if (!existing.outlines.includes(item.outline)) existing.outlines.push(item.outline)
}

function parseSourceRows() {
  const raw = readFileSync(csvPath, 'utf8')
  const rows = parseCsv(raw)
  const sourceMap = new Map()
  let withScene = 0
  let emptyOutline = 0

  rows.forEach((row, idx) => {
    const epKey = epKeyFromRaw(row[2])
    const sceneKey = cleanCell(row[3])
    const outline = cleanCell(row[11])
    if (!epKey || !sceneKey) return
    withScene++
    if (!outline) {
      emptyOutline++
      return
    }
    addSource(sourceMap, { epKey, sceneKey, outline, csvRow: idx + 1 })
  })

  return {
    rows,
    sourceRows: [...sourceMap.values()].map(item => ({
      epKey: item.epKey,
      sceneKey: item.sceneKey,
      outline: item.outlines.join('\n'),
      sourceRows: item.sourceRows,
      outlineParts: item.outlines.length,
    })),
    withScene,
    emptyOutline,
  }
}

async function fetchDbScenes() {
  const { data: episodes, error: epError } = await supabase
    .from('episodes')
    .select('id, ep_key')
    .eq('project_id', projectId)

  if (epError) throw new Error(`episodes query failed: ${epError.message}`)
  const episodeRows = episodes ?? []
  const episodeByKey = new Map(episodeRows.map(ep => [ep.ep_key, ep]))
  const episodeIdToKey = new Map(episodeRows.map(ep => [ep.id, ep.ep_key]))
  const episodeIds = episodeRows.map(ep => ep.id)

  if (episodeIds.length === 0) {
    return { episodeByKey, sceneByKey: new Map(), outlineColumnExists: true }
  }

  let outlineColumnExists = true
  let { data: scenes, error: sceneError } = await supabase
    .from('scenes')
    .select('id, episode_id, scene_key, outline')
    .in('episode_id', episodeIds)

  if (sceneError && sceneError.message.includes('outline')) {
    outlineColumnExists = false
    const fallback = await supabase
      .from('scenes')
      .select('id, episode_id, scene_key')
      .in('episode_id', episodeIds)
    scenes = fallback.data
    sceneError = fallback.error
  }

  if (sceneError) throw new Error(`scenes query failed: ${sceneError.message}`)

  const sceneByKey = new Map()
  for (const scene of scenes ?? []) {
    const epKey = episodeIdToKey.get(scene.episode_id)
    if (epKey) sceneByKey.set(`${epKey}\t${scene.scene_key}`, scene)
  }

  return { episodeByKey, sceneByKey, outlineColumnExists }
}

function buildPlan(sourceRows, db) {
  const updates = []
  const unchanged = []
  const unmatchedEpisodes = []
  const unmatchedScenes = []
  const duplicateSources = []

  for (const source of sourceRows) {
    const key = `${source.epKey}\t${source.sceneKey}`
    if (source.sourceRows.length > 1 || source.outlineParts > 1) duplicateSources.push(source)

    if (!db.episodeByKey.has(source.epKey)) {
      unmatchedEpisodes.push(source)
      continue
    }

    const scene = db.sceneByKey.get(key)
    if (!scene) {
      unmatchedScenes.push(source)
      continue
    }

    const currentOutline = cleanCell(scene.outline)
    if (currentOutline === source.outline) {
      unchanged.push({ ...source, id: scene.id })
      continue
    }

    updates.push({
      ...source,
      id: scene.id,
      previousOutline: currentOutline,
      overwrite: currentOutline !== '',
    })
  }

  return { updates, unchanged, unmatchedEpisodes, unmatchedScenes, duplicateSources }
}

async function applyUpdates(updates) {
  for (const update of updates) {
    const { error } = await supabase
      .from('scenes')
      .update({ outline: update.outline })
      .eq('id', update.id)
    if (error) throw new Error(`${update.epKey}/${update.sceneKey}: ${error.message}`)
  }
}

function printSample(label, rows, render) {
  if (rows.length === 0) return
  console.log(`\n${label}`)
  for (const row of rows.slice(0, 10)) {
    console.log(`- ${render(row)}`)
  }
  if (rows.length > 10) console.log(`- ...and ${rows.length - 10} more`)
}

async function main() {
  const parsed = parseSourceRows()
  const db = await fetchDbScenes()
  const plan = buildPlan(parsed.sourceRows, db)
  const overwriteCount = plan.updates.filter(u => u.overwrite).length

  console.log(apply ? 'MODE: APPLY' : 'MODE: DRY RUN')
  console.log(`CSV: ${csvPath}`)
  console.log(`Project: ${projectId}`)
  console.log(`CSV rows: ${parsed.rows.length}`)
  console.log(`Rows with scene key: ${parsed.withScene}`)
  console.log(`Rows skipped because outline is empty: ${parsed.emptyOutline}`)
  console.log(`Unique source scene outlines: ${parsed.sourceRows.length}`)
  console.log(`Matched updates: ${plan.updates.length}`)
  console.log(`Unchanged: ${plan.unchanged.length}`)
  console.log(`Would overwrite non-empty outline: ${overwriteCount}`)
  console.log(`Duplicate source keys combined: ${plan.duplicateSources.length}`)
  console.log(`Unmatched episodes: ${plan.unmatchedEpisodes.length}`)
  console.log(`Unmatched scenes: ${plan.unmatchedScenes.length}`)
  if (!db.outlineColumnExists) {
    console.log('Remote DB note: scenes.outline column does not exist yet. Run supabase/add-scene-outline.sql before --apply.')
  }

  printSample('Update sample:', plan.updates, row =>
    `${row.epKey}/${row.sceneKey} <- ${row.outline.slice(0, 80)}`,
  )
  printSample('Overwrite sample:', plan.updates.filter(u => u.overwrite), row =>
    `${row.epKey}/${row.sceneKey} was "${row.previousOutline.slice(0, 40)}"`,
  )
  printSample('Duplicate source sample:', plan.duplicateSources, row =>
    `${row.epKey}/${row.sceneKey} CSV rows ${row.sourceRows.join(', ')}`,
  )
  printSample('Unmatched scene sample:', plan.unmatchedScenes, row =>
    `${row.epKey}/${row.sceneKey} <- ${row.outline.slice(0, 80)}`,
  )

  if (!apply) {
    console.log('\nDry-run only. Add --apply after reviewing the counts.')
    return
  }

  if (!db.outlineColumnExists) {
    throw new Error('Cannot apply: remote DB is missing scenes.outline. Run supabase/add-scene-outline.sql first.')
  }

  await applyUpdates(plan.updates)
  console.log(`\nApplied ${plan.updates.length} outline updates.`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
