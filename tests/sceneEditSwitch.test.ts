import assert from 'node:assert/strict'
import test from 'node:test'
import { saveBeforeSceneSwitch } from '../src/lib/sceneEditSwitch.ts'

test('waits for the current draft to save before allowing a different row', async () => {
  let finishSave!: (saved: boolean) => void
  const saveResult = new Promise<boolean>(resolve => { finishSave = resolve })
  let settled = false
  const switching = saveBeforeSceneSwitch(
    { rowIndex: 1, draft: { roughcutLength: '00:01:00' } },
    2,
    async () => saveResult,
  ).then(result => { settled = true; return result })

  await Promise.resolve()
  assert.equal(settled, false)
  finishSave(true)
  assert.equal(await switching, true)
})

test('does not save when no row is being edited or the same row is requested', async () => {
  let calls = 0
  const save = async () => { calls += 1; return true }
  assert.equal(await saveBeforeSceneSwitch(null, 2, save), true)
  assert.equal(await saveBeforeSceneSwitch({ rowIndex: 2, draft: {} }, 2, save), true)
  assert.equal(calls, 0)
})

test('blocks the switch when saving fails', async () => {
  const result = await saveBeforeSceneSwitch(
    { rowIndex: 1, draft: {} },
    2,
    async () => false,
  )
  assert.equal(result, false)
})
