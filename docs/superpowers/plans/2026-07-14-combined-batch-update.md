# Combined Scene Batch Update Implementation Plan

> **For agentic workers:** Follow the tasks in order. Keep each change limited to the approved status-and-date batch workflow, and verify after every task.

**Goal:** Let desktop and mobile users update selected scenes' status, rough-cut date, or both in one confirmation and one batch write.

**Architecture:** Keep selection and dialog state in `SceneTable`. Add one pure helper that converts the dialog settings into both the exact scene patch and the confirmation summary. Replace the two parent callbacks with one `EpisodeDetail` batch callback that merges the patch into each selected `SceneRow`, calls the existing `batchUpdateScenes` once, then updates cache and summary once. Reuse one dialog component and one submit handler for desktop and mobile.

**Tech Stack:** React 19, TypeScript 6, Node.js 24 built-in test runner, Vite 8, Supabase

---

### Task 1: Define and test the batch-update rules

**Files:**
- Create: `src/lib/batchSceneUpdate.ts`
- Create: `tests/batchSceneUpdate.test.ts`

- [ ] **Step 1: Write failing tests for every patch shape**

Cover these cases with Node's built-in test runner:

1. Status and date both set to `unchanged` produce no update plan.
2. Setting or clearing status produces a patch with a `status` key and no `roughcutDate` key.
3. Setting or clearing date produces a patch with a `roughcutDate` key and no `status` key.
4. Setting both fields produces one patch containing both keys.
5. Applying a patch preserves every field that is absent from the patch.
6. Confirmation text describes the same fields and values contained in the patch.

Run: `node --test tests/batchSceneUpdate.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/batchSceneUpdate.ts`.

- [ ] **Step 2: Implement the smallest pure helper**

Use explicit choices so `unchanged`, `clear`, and a real value cannot be confused:

```ts
export type BatchStatusChoice =
  | 'unchanged'
  | 'roughcut'
  | 'finecut'
  | 'deleted'
  | 'clear'

export type BatchDateMode = 'unchanged' | 'set' | 'clear'

export interface BatchUpdateSettings {
  status: BatchStatusChoice
  dateMode: BatchDateMode
  date: string
}

export type BatchScenePatch = Partial<Pick<SceneRow, 'status' | 'roughcutDate'>>

export interface BatchUpdatePlan {
  patch: BatchScenePatch
  changes: string[]
}
```

Implement:

- `buildBatchUpdatePlan(settings): BatchUpdatePlan | null`
- `applyBatchScenePatch(scene, patch): SceneRow`

`buildBatchUpdatePlan` is the only mapping source for both the stored values and the confirmation summary. Map status choices only to the existing values `已初剪`, `已精剪`, `整場刪除`, and `''`. Do not include `尚缺鏡頭`; it is the separate `missingShots` field and is outside this feature.

When `dateMode` is `set`, normalize the supplied date with the existing `formatDate`. When it is `clear`, use `''`. Return `null` when both fields remain unchanged or when `dateMode` is `set` but the date is empty.

- [ ] **Step 3: Run the focused tests**

Run: `node --test tests/batchSceneUpdate.test.ts`

Expected: all new tests pass, 0 fail.

### Task 2: Replace the duplicate parent handlers with one batch write

**Files:**
- Modify: `src/components/EpisodeDetail.tsx:129-172`
- Modify: `src/components/EpisodeDetail.tsx:372-381`

- [ ] **Step 1: Replace the two handlers**

Replace `handleBatchUpdateStatus` and `handleBatchUpdateDate` with:

```ts
async function handleBatchUpdate(rowIndices: number[], patch: BatchScenePatch) {
  // merge the patch into each target SceneRow
  // call batchUpdateScenes once
  // update cache once
  // sync summary once
}
```

Use `applyBatchScenePatch` when building both the service payload and the updated local scene list, so the persisted data and cache use the same merge rule.

Keep the existing error alert and rethrow behavior. Do not change `handleBatchDeleteScenes` or any service/schema interface.

- [ ] **Step 2: Replace the child props**

Replace the two `SceneTable` props `onBatchUpdateStatus` and `onBatchUpdateDate` with one `onBatchUpdate` prop accepting selected row indices and `BatchScenePatch`.

- [ ] **Step 3: Compile the parent integration**

Run: `npm run build`

Expected: TypeScript and Vite exit 0. If `SceneTable` has not yet been migrated, the only expected intermediate errors are the deliberately changed callback props; do not broaden the fix.

### Task 3: Add one shared submit lifecycle in `SceneTable`

**Files:**
- Modify: `src/components/SceneTable.tsx:80-185`
- Modify: `src/components/SceneTable.tsx:380-428`

- [ ] **Step 1: Replace the old batch UI state**

Replace `showBatchMenu` and `batchDate` with:

- `showBatchUpdate`
- one `BatchUpdateSettings` state initialized to both fields unchanged

When the user changes the date mode from unchanged/clear to `set`, populate an empty date with `todayYMD()`. Do not make today's date active until the user explicitly selects `set`.

- [ ] **Step 2: Add deterministic reset and close helpers**

Add small local helpers that:

- reset settings to both fields unchanged;
- close the dialog and reset settings while preserving selected scenes;
- reset/close the dialog when `resetKey` changes.

Backdrop, close button, and `Esc` all use the same close helper. Include the batch dialog in body-scroll locking while it is open on mobile.

- [ ] **Step 3: Add the single submit handler**

The submit handler must:

1. Find the selected row indices.
2. Call `buildBatchUpdatePlan` once.
3. Stop when the plan is `null`.
4. Build the confirmation message from `plan.changes`.
5. Preserve the dialog, settings, and selection when browser confirmation is cancelled.
6. Call `onBatchUpdate(indices, plan.patch)` once after confirmation.
7. Clear selection, close, and reset only after success.
8. Leave the dialog, settings, and selection untouched after failure.

Disable all dialog inputs/actions while `saving` is true.

### Task 4: Use one dialog for desktop and mobile

**Files:**
- Modify: `src/components/SceneTable.tsx:503-555`
- Modify: `src/components/SceneTable.tsx:818-922`
- Modify: `src/components/SceneTable.tsx` near the existing Bottom Sheet components
- Modify: `src/App.css:260-380`

- [ ] **Step 1: Simplify both batch toolbars**

Desktop selected-state controls become:

- `批次修改（N）`
- the existing independent `批次刪除（N）`

Mobile selected-state controls become:

- `已選 N`
- `批次修改`
- the existing `刪除`
- the existing selection cancel action

Remove the old desktop status menu/date controls and the old mobile quick-status/date controls. Do not change selection, Shift-selection, or batch-delete handlers.

- [ ] **Step 2: Add one `BatchUpdateDialog` component**

The shared component receives the settings, setters, selected count, save state, submit callback, and close callback. It renders:

- status: `維持不變`, `已初剪`, `已精剪`, `整場刪除`, `清除狀態`;
- date mode: `維持不變`, `指定日期`, `清除日期`;
- the date input only when date mode is `指定日期`;
- `取消` and `套用到 N 個場次`.

Disable the apply button when `buildBatchUpdatePlan(settings)` is `null` or while saving.

- [ ] **Step 3: Add focused responsive styling**

Reuse the existing Bottom Sheet visual language. The same JSX should appear as a centered dialog on desktop and a bottom-aligned sheet on mobile. Add only the CSS needed for this component; do not restyle existing scene-edit sheets or unrelated controls.

- [ ] **Step 4: Run static verification**

Run:

```bash
node --test tests/batchSceneUpdate.test.ts tests/selectionRange.test.ts tests/sceneEditSwitch.test.ts
npm run lint
npm run build
git diff --check
```

Expected: all tests, lint, build, and whitespace checks pass.

### Task 5: Verify real behavior and scope

**Files:**
- Verify: `src/lib/batchSceneUpdate.ts`
- Verify: `tests/batchSceneUpdate.test.ts`
- Verify: `src/components/SceneTable.tsx`
- Verify: `src/components/EpisodeDetail.tsx`
- Verify: `src/App.css`

- [ ] **Step 1: Audit the diff**

Run:

```bash
git diff --stat
git diff -- \
  src/lib/batchSceneUpdate.ts \
  tests/batchSceneUpdate.test.ts \
  src/components/SceneTable.tsx \
  src/components/EpisodeDetail.tsx \
  src/App.css
```

Expected: only the approved combined status/date batch workflow and its tests/styles changed. No schema, `missingShots`, batch-delete, import, or scene-edit behavior changed.

- [ ] **Step 2: Verify desktop and mobile in the Codex app Browser**

Use local non-production data and verify both desktop and mobile viewport behavior:

1. Status only preserves dates.
2. Date only preserves statuses.
3. Status and date change together after one confirmation.
4. Status and date can each be cleared, separately or together.
5. Both unchanged disables apply.
6. Backdrop, close, and `Esc` write nothing, preserve selection, and reset settings.
7. Cancelling browser confirmation keeps the dialog, settings, and selection.
8. A failed write keeps the dialog, settings, and selection.
9. A successful write closes the dialog and clears selection.
10. Simultaneous modification triggers one batch request.
11. Shift-selection, batch delete, and scene editing still work.

Do not test writes against production. If local test data or a safe login state is unavailable, report the missing browser cases as unverified instead of substituting a production write.

- [ ] **Step 3: Run final verification and commit only approved files**

Run the focused tests, lint, build, and `git diff --check` again. Then stage only:

```bash
git add \
  docs/superpowers/plans/2026-07-14-combined-batch-update.md \
  src/lib/batchSceneUpdate.ts \
  tests/batchSceneUpdate.test.ts \
  src/components/SceneTable.tsx \
  src/components/EpisodeDetail.tsx \
  src/App.css
```

Commit message: `feat: combine scene batch status and date`
