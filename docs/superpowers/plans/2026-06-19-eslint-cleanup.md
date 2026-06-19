# ESLint Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Roughcut Tracker from 76 ESLint errors and 4 warnings to zero without changing user-visible behavior or stored data.

**Architecture:** Treat `npm run lint` as the failing regression check and fix one rule family at a time. Use mechanical edits for whitespace and regexes, small module splits for Fast Refresh, a narrow props destructure for the ref false positive, and behavior-preserving React lifecycle refactors for effect rules.

**Tech Stack:** React 19, TypeScript 6, ESLint 9, eslint-plugin-react-hooks 7, Vite 8, Node.js 24 test runner

---

### Task 1: Mechanical rule cleanup

**Files:**
- Modify: `eslint.config.js`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/DashboardExportMD.tsx`
- Modify: `src/components/ManageMembersModal.tsx`
- Modify: `src/components/QuickPage.tsx`
- Modify: `src/components/SceneTable.tsx`
- Modify: `src/lib/stats.ts`
- Modify: `src/services/supabaseService.ts`

- [x] **Step 1: Record the failing baseline**

Run: `npm run lint`

Expected: `80 problems (76 errors, 4 warnings)`.

- [x] **Step 2: Remove unnecessary regex escapes**

Convert date separators such as:

```ts
/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
```

to:

```ts
/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/
```

Apply the same character-class correction in `SceneTable.tsx`, `stats.ts`, and `supabaseService.ts`.

- [x] **Step 3: Replace irregular whitespace without changing labels**

Replace full-width spaces in visible strings and export strings with ordinary spaces. Preserve the text and separator order, for example:

```tsx
<div style={s.memberMeta}>{invite.role} · 等待登入</div>
```

- [x] **Step 4: Ignore intentionally unused underscore parameters**

Add this rule to the TypeScript ESLint block:

```js
rules: {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
},
```

This keeps ordinary unused variables as errors while accepting interface-compatible no-op parameters such as `_project` and `_token`.

- [x] **Step 5: Verify the first reduction**

Run: `npm run lint`

Expected: no `no-useless-escape`, `no-irregular-whitespace`, or `@typescript-eslint/no-unused-vars` findings; tests and build still pass.

### Task 2: Fast Refresh boundaries and ref false positive

**Files:**
- Create: `src/components/sceneTableFields.ts`
- Create: `src/contexts/projectContextValue.ts`
- Create: `src/contexts/useProject.ts`
- Modify: `src/components/SceneTable.tsx`
- Modify: `src/components/EpisodeDetail.tsx`
- Modify: `src/contexts/ProjectContext.tsx`
- Modify imports in: `src/App.tsx`, `src/components/Dashboard.tsx`, `src/components/EpisodeDetail.tsx`, `src/components/QuickPage.tsx`, `src/hooks/useEpisodesCache.ts`, `src/main.tsx`

- [x] **Step 1: Move scene field constants out of the component module**

Create `sceneTableFields.ts` containing the existing `EP_COL_DEFS`, `EP_PDF_FIELDS`, and `EP_PDF_DEFAULTS` definitions. Import them into `SceneTable.tsx` and `EpisodeDetail.tsx` so `SceneTable.tsx` exports only its component.

- [x] **Step 2: Split the project context hook from its provider**

Create `projectContextValue.ts`:

```ts
import { createContext } from 'react'
import type { ProjectConfig } from '../config/projectConfig'

export interface ProjectContextValue {
  project: ProjectConfig
  setProject: (project: ProjectConfig) => void
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)
```

Create `useProject.ts`:

```ts
import { useContext } from 'react'
import { ProjectContext, type ProjectContextValue } from './projectContextValue'

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) throw new Error('useProject must be used inside ProjectProvider')
  return context
}
```

Keep `ProjectContext.tsx` focused on `ProjectProvider`, then update all imports.

- [x] **Step 3: Isolate the mobile menu ref from the remaining props**

Change the mobile component signature to:

```tsx
function MobileView({ mobileMenuRef, ...p }: MobileProps) {
```

Keep the existing `p.` accesses and pass `mobileMenuRef` directly to the one `ref` attribute. The rest object no longer contains a ref, so the hook rule will not treat every later property as a ref access.

- [x] **Step 4: Verify the second reduction**

Run: `npm run lint`

Expected: no `react-refresh/only-export-components` or `react-hooks/refs` findings.

### Task 3: Effect and dependency cleanup

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/EpisodeDetail.tsx`
- Modify: `src/components/ManageMembersModal.tsx`
- Modify: `src/components/ProjectPicker.tsx`
- Modify: `src/components/QuickPage.tsx`
- Modify: `src/components/SceneTable.tsx`
- Modify: `src/components/SupabasePreview.tsx`
- Modify: `src/hooks/useAuth.ts`
- Modify: `src/hooks/useEpisodesCache.ts`
- Modify: `src/hooks/useMediaQuery.ts`

- [x] **Step 1: Replace prop-driven resets with remount or event updates**

- Give `SceneTable` a `key={episode}` in `EpisodeDetail`, remove its `resetKey` prop, and delete the state-reset effect.
- Remove `FinecutSheet`'s `initialValue` synchronization effect because the conditional sheet remounts for each editing session.
- In `App`, set the default view inside project-selection and remembered-project callbacks, then remove the view-reset effect.

- [x] **Step 2: Keep asynchronous loading state changes in promise callbacks**

For `ManageMembersModal` and `ProjectPicker`, make mount effects start service promises directly and place state updates in `.then()` / `.catch()` callbacks. Keep reusable `refresh()` functions for user-triggered mutations.

For `SupabasePreview`, reset dependent lists and set loading state in sign-in/project/episode event callbacks. Keep effects responsible only for issuing reads and applying their asynchronous results.

- [x] **Step 3: Use lifecycle-native hook patterns**

- Initialize `useAuth` readiness with `useState(() => !hasSupabaseConfig())` and let the effect return immediately when configuration is absent.
- In `useEpisodesCache`, hide stale `scenes` and `meta` in the returned value when `token` is null; keep the effect's null-token branch limited to resetting `loadedKeyRef`.
- Rewrite `useMediaQuery` with `useSyncExternalStore`, using `matchMedia().matches` as the snapshot and its `change` event as the subscription.
- Memoize `QuickPage`'s `scenes` derivation so its downstream memo dependencies are stable.

- [x] **Step 4: Stabilize SceneTable autosave dependencies**

Wrap `saveEdit` and `queueAutoSave` in `useCallback`, move the document autosave effect below them, and include `queueAutoSave` in the dependency list. Preserve the existing serialized queue and save-before-switch behavior.

- [x] **Step 5: Run the final lint gate**

Run: `npm run lint`

Expected: exit 0 with no errors or warnings.

### Task 4: Regression verification and commit

**Files:**
- Verify all files changed in Tasks 1-3
- Include: `docs/superpowers/plans/2026-06-19-eslint-cleanup.md`

- [x] **Step 1: Run complete verification**

Run:

```bash
npm run lint
node --test tests/sceneEditSwitch.test.ts
npm run build
git diff --check
```

Expected: lint exits 0; 3 tests pass; production build succeeds; diff check reports nothing.

- [x] **Step 2: Review scope and behavior-sensitive changes**

Run: `git diff --stat && git diff`

Confirm that no database schema, service payload, status semantics, export fields, or mobile/desktop feature behavior changed.

- [x] **Step 3: Commit the cleanup**

```bash
git add eslint.config.js docs/superpowers/plans/2026-06-19-eslint-cleanup.md src
git commit -m "chore: resolve eslint errors"
```
