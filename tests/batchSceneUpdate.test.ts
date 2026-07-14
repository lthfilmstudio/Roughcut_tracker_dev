import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBatchScenePatch,
  buildBatchUpdatePlan,
  type BatchUpdateSettings,
} from '../src/lib/batchSceneUpdate.ts'
import type { SceneRow } from '../src/types/index.ts'

const unchanged: BatchUpdateSettings = {
  status: 'unchanged',
  dateMode: 'unchanged',
  date: '',
}

const scene: SceneRow = {
  scene: '12A',
  roughcutLength: '00:01:23',
  pages: '2.5',
  roughcutDate: '2026/07/01',
  status: '已初剪',
  missingShots: '特寫',
  outline: '角色進場',
  notes: '保留這筆備註',
}

test('returns no plan when status and date are unchanged', () => {
  assert.equal(buildBatchUpdatePlan(unchanged), null)
})

test('returns no plan when set date is empty', () => {
  assert.equal(buildBatchUpdatePlan({ ...unchanged, dateMode: 'set' }), null)
  assert.equal(buildBatchUpdatePlan({ status: 'roughcut', dateMode: 'set', date: '  ' }), null)
})

test('sets or clears status without including roughcutDate', () => {
  assert.deepEqual(
    buildBatchUpdatePlan({ ...unchanged, status: 'finecut' }),
    { patch: { status: '已精剪' }, changes: ['狀態：已精剪'] },
  )
  assert.deepEqual(
    buildBatchUpdatePlan({ ...unchanged, status: 'clear' }),
    { patch: { status: '' }, changes: ['狀態：清除'] },
  )
})

test('sets or clears date without including status', () => {
  assert.deepEqual(
    buildBatchUpdatePlan({ ...unchanged, dateMode: 'set', date: '2026-7-9' }),
    { patch: { roughcutDate: '2026/07/09' }, changes: ['日期：2026/07/09'] },
  )
  assert.deepEqual(
    buildBatchUpdatePlan({ ...unchanged, dateMode: 'clear' }),
    { patch: { roughcutDate: '' }, changes: ['日期：清除'] },
  )
})

test('sets status and date in one patch', () => {
  assert.deepEqual(
    buildBatchUpdatePlan({ status: 'deleted', dateMode: 'set', date: '2026/7/14' }),
    {
      patch: { status: '整場刪除', roughcutDate: '2026/07/14' },
      changes: ['狀態：整場刪除', '日期：2026/07/14'],
    },
  )
})

test('applying a patch preserves fields absent from the patch', () => {
  const updated = applyBatchScenePatch(scene, { status: '已精剪' })

  assert.deepEqual(updated, { ...scene, status: '已精剪' })
  assert.equal(updated.roughcutDate, scene.roughcutDate)
  assert.equal(updated.missingShots, scene.missingShots)
  assert.notEqual(updated, scene)
})

test('confirmation changes match every field and value in the patch', () => {
  const settings: BatchUpdateSettings[] = [
    { ...unchanged, status: 'roughcut' },
    { ...unchanged, status: 'clear' },
    { ...unchanged, dateMode: 'set', date: '2026-07-14' },
    { ...unchanged, dateMode: 'clear' },
    { status: 'finecut', dateMode: 'set', date: '2026-07-14' },
  ]

  for (const value of settings) {
    const plan = buildBatchUpdatePlan(value)
    assert.notEqual(plan, null)
    assert.equal(plan!.changes.length, Object.keys(plan!.patch).length)

    if ('status' in plan!.patch) {
      const expected = plan!.patch.status ? `狀態：${plan!.patch.status}` : '狀態：清除'
      assert.ok(plan!.changes.includes(expected))
    }
    if ('roughcutDate' in plan!.patch) {
      const expected = plan!.patch.roughcutDate ? `日期：${plan!.patch.roughcutDate}` : '日期：清除'
      assert.ok(plan!.changes.includes(expected))
    }
  }
})
