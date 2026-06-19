# Scene Edit Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure desktop scene switching saves the current draft first, default batch dates to today, and let desktop users double-click only the length cell to begin editing.

**Architecture:** Keep `SceneTable` as the UI owner and retain its existing serialized autosave queue. Add one small pure coordinator for the save-before-switch decision, then use refs to synchronously preserve the active row/draft and to focus the length input after desktop double-click.

**Tech Stack:** React 19, TypeScript 6, Node.js 24 built-in test runner, Vite 8

---

### Task 1: Add a tested save-before-switch coordinator

**Files:**
- Create: `src/lib/sceneEditSwitch.ts`
- Create: `tests/sceneEditSwitch.test.ts`

- [ ] **Step 1: Write the failing coordinator tests**

```ts
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
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test tests/sceneEditSwitch.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/sceneEditSwitch.ts`.

- [ ] **Step 3: Implement the smallest coordinator**

```ts
interface ActiveSceneEdit<T> {
  rowIndex: number
  draft: T
}

export async function saveBeforeSceneSwitch<T>(
  current: ActiveSceneEdit<T> | null,
  nextRowIndex: number,
  save: (rowIndex: number, draft: T) => Promise<boolean>,
): Promise<boolean> {
  if (!current || current.rowIndex === nextRowIndex) return true
  return save(current.rowIndex, current.draft)
}
```

- [ ] **Step 4: Run the tests and verify all three pass**

Run: `node --test tests/sceneEditSwitch.test.ts`

Expected: 3 tests pass, 0 fail.

### Task 2: Wire deterministic switching, today defaults, and length double-click

**Files:**
- Modify: `src/components/SceneTable.tsx:1-230`
- Modify: `src/components/SceneTable.tsx:543-660`

- [ ] **Step 1: Import the coordinator and add synchronous refs**

Add `saveBeforeSceneSwitch` beside the existing imports. Add a `lengthInputRef` and a `focusLengthOnEditRef`; keep `editRowRef` and `draftRef` synchronized inside the functions that open and close an editor instead of waiting only for React effects.

- [ ] **Step 2: Make saves report success and switch rows through the queue**

Change `saveEdit()` to return `Promise<boolean>`: return `true` after `onUpdateScene` succeeds and `false` after its existing error path. Change the autosave queue ref to `Promise<boolean>` and preserve serialized execution.

Replace direct desktop `startEdit(i)` calls with an async `switchEdit(i, { focusLength?: boolean })` that:

```ts
const current = editRowRef.current !== null && draftRef.current
  ? { rowIndex: editRowRef.current, draft: draftRef.current }
  : null
const canSwitch = await saveBeforeSceneSwitch(
  current,
  i,
  (rowIndex, currentDraft) => queueAutoSave(rowIndex, currentDraft),
)
if (!canSwitch) return
openEdit(i, opts)
```

Mark desktop「編輯」buttons with `data-scene-edit-trigger="true"`, skip those targets in the document-level `mousedown` saver, and let `switchEdit` own their save-before-open sequence. This prevents the same click from queuing two differently-scoped saves.

- [ ] **Step 3: Default the shared batch date state to today**

Use `useState(todayYMD)` for `batchDate`. Replace reset/success assignments of `''` with `todayYMD()` so both desktop and mobile receive today through their existing shared prop. Keep the dedicated clear-date action unchanged.

- [ ] **Step 4: Add desktop-only length double-click and focus**

On the non-editing desktop length `<td>`, add `onDoubleClick={() => { void switchEdit(i, { focusLength: true }) }}`. Attach `lengthInputRef` only to the active desktop length input and focus/select it in an effect after `editRow` changes when `focusLengthOnEditRef.current` is set. Do not change `MobileView` or `SceneFormSheet`.

- [ ] **Step 5: Run focused and static verification**

Run: `node --test tests/sceneEditSwitch.test.ts && npm run lint && npm run build`

Expected: 3 tests pass; ESLint exits 0; TypeScript and Vite build exit 0.

### Task 3: Verify behavior and commit the implementation

**Files:**
- Verify: `src/components/SceneTable.tsx`
- Verify: `src/lib/sceneEditSwitch.ts`
- Verify: `tests/sceneEditSwitch.test.ts`
- Include: `docs/superpowers/plans/2026-06-19-scene-edit-autosave.md`

- [ ] **Step 1: Inspect the final diff for scope**

Run: `git diff --check && git diff --stat && git diff -- src/components/SceneTable.tsx src/lib/sceneEditSwitch.ts tests/sceneEditSwitch.test.ts`

Expected: only the approved event flow, today defaults, desktop length double-click, and focused coordinator test are present.

- [ ] **Step 2: Verify desktop interaction in the Codex app internal Browser**

Start the local Vite server, then verify:

1. Edit scene A and click scene B「編輯」; A saves before B opens.
2. Cancel or `Esc` still discards the current unsaved draft.
3. Batch date initially displays today and returns to today after a successful batch update.
4. Double-clicking a desktop length cell opens that row and selects the length value.
5. Double-clicking other desktop cells does nothing.
6. Mobile layout and Bottom Sheet remain unchanged.

- [ ] **Step 3: Commit only the approved files**

```bash
git add \
  docs/superpowers/plans/2026-06-19-scene-edit-autosave.md \
  src/components/SceneTable.tsx \
  src/lib/sceneEditSwitch.ts \
  tests/sceneEditSwitch.test.ts
git commit -m "feat: improve scene editing flow"
```
