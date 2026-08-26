# Local Schema `folder_id` Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing local PGlite vault databases gain missing nullable `folder_id` columns without changing or deleting stored vault data.

**Architecture:** Keep the existing fresh-install `CREATE TABLE IF NOT EXISTS` schema. Add an idempotent migration immediately after table creation in `src/lib/db.ts`, using a fixed allowlist of local encrypted record tables so dynamic SQL identifiers cannot come from user input. Export the schema initializer for an integration regression test that exercises a legacy `tasks` table and confirms data survives migration.

**Tech Stack:** TypeScript, PGlite, Node’s built-in test runner, npm scripts, Vite.

## Global Constraints

- Preserve existing local vault data in place; never reset or recreate the PGlite database as migration recovery.
- Add `folder_id TEXT` only to `folders`, `credentials`, `notes`, `tasks`, `income`, and `activity_log`.
- Keep `app_settings` without a `folder_id` column.
- Do not change encryption, repository APIs, sync formats, or Supabase migrations.
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so schema initialization is safe on fresh and already-migrated databases.
- Follow TDD: run the regression test and observe the expected failure before adding production migration code.

---

### Task 1: Add a failing legacy-schema regression test

**Files:**
- Create: `test/localSchemaMigration.test.ts`
- Modify: none

**Interfaces:**
- Consumes: the existing `PGlite` package and the `initSchema(db: PGlite): Promise<void>` initializer, which will be exported from `src/lib/db.ts` in Task 2.
- Produces: a regression test proving that a legacy `tasks` table receives `folder_id`, that all affected tables expose the column after initialization, that existing task data remains readable, and that a second initialization is harmless.

- [ ] **Step 1: Write the failing test**

Create `test/localSchemaMigration.test.ts` with this test:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initSchema } from '../src/lib/db.ts';

const affectedTables = ['folders', 'credentials', 'notes', 'tasks', 'income', 'activity_log'];

test('migrates legacy local tables with folder_id without losing task data', async () => {
  const db = new PGlite(`memory://local-schema-migration-${Date.now()}-${Math.random()}`);
  try {
    await db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      INSERT INTO tasks (id, owner_id, payload, created_at, updated_at, deleted_at)
      VALUES ('legacy-task', 'owner-1', 'encrypted-payload', '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z', NULL);
    `);

    await initSchema(db);

    for (const table of affectedTables) {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = 'folder_id'`,
      );
      assert.equal(result.rows.length, 1, `${table}.folder_id should exist`);
    }

    await db.query("SELECT set_config('app.user_id', 'owner-1', false)");
    const task = await db.query<{ id: string; folder_id: string | null; payload: string }>(
      'SELECT id, folder_id, payload FROM tasks WHERE id = $1',
      ['legacy-task'],
    );
    assert.deepEqual(task.rows, [{ id: 'legacy-task', folder_id: null, payload: 'encrypted-payload' }]);

    await initSchema(db);
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails for the expected reason**

Run:

```powershell
npm test -- test/localSchemaMigration.test.ts
```

Expected before the implementation: the test fails because `initSchema` is not exported (or, after exporting only for test access, because the legacy `tasks` table still lacks `folder_id`). Do not change the assertion to accommodate the current broken behavior.

- [ ] **Step 3: Commit the red test**

```powershell
git add test/localSchemaMigration.test.ts
git commit -m "test: reproduce missing local folder id column"
```

### Task 2: Implement the idempotent local schema migration

**Files:**
- Modify: `src/lib/db.ts:1-160`
- Test: `test/localSchemaMigration.test.ts`

**Interfaces:**
- Consumes: the existing `PGlite` instance passed to schema initialization.
- Produces: `export async function initSchema(db: PGlite): Promise<void>` for the regression test and application startup, plus migration behavior for all six affected tables.

- [ ] **Step 1: Export the existing schema initializer without changing its behavior**

Change only the declaration in `src/lib/db.ts` from:

```typescript
async function initSchema(db: PGlite): Promise<void> {
```

to:

```typescript
export async function initSchema(db: PGlite): Promise<void> {
```

- [ ] **Step 2: Add the fixed migration table list and migration function**

Place this allowlist before `initSchema`:

```typescript
const LOCAL_TABLES_WITH_FOLDER_ID = ['folders', 'credentials', 'notes', 'tasks', 'income', 'activity_log'] as const;
```

Place this function after the existing `initSchema` function’s schema `db.exec` block and before `createOwnerPolicy`:

```typescript
async function migrateLocalSchema(db: PGlite): Promise<void> {
  for (const table of LOCAL_TABLES_WITH_FOLDER_ID) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS folder_id TEXT;`);
  }
}
```

- [ ] **Step 3: Run the migration before owner policies are created**

In `initSchema`, immediately after the closing `await db.exec(`...`);` that creates the tables and before the first `await createOwnerPolicy(...)`, add:

```typescript
  await migrateLocalSchema(db);
```

The resulting order must be: create-if-missing tables, add missing columns, then enable/create owner policies. Keep `app_settings` out of the allowlist and leave all repository and sync SQL unchanged.

- [ ] **Step 4: Run the focused test to verify the fix passes**

Run:

```powershell
npm test -- test/localSchemaMigration.test.ts
```

Expected: the test passes, including the existing-row payload assertion and the second `initSchema(db)` call.

- [ ] **Step 5: Commit the minimal implementation**

```powershell
git add src/lib/db.ts test/localSchemaMigration.test.ts
git commit -m "fix: migrate legacy local folder id columns"
```

### Task 3: Run complete verification and inspect the change

**Files:**
- Modify: none unless verification identifies a regression
- Test: `test/localSchemaMigration.test.ts` plus the existing test suite

**Interfaces:**
- Consumes: the committed migration and regression test from Task 2.
- Produces: fresh evidence that the missing-column error is covered and that the project remains type-safe, lint-clean, and buildable.

- [ ] **Step 1: Run the full test suite**

Run:

```powershell
npm test
```

Expected: exit code `0` with all tests passing, including `test/localSchemaMigration.test.ts`.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: exit code `0` and no TypeScript errors.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code `0` and no ESLint errors or warnings introduced by the change.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: exit code `0` and a successfully generated Vite production bundle.

- [ ] **Step 5: Inspect the final diff and status**

Run:

```powershell
git diff HEAD~1 -- src/lib/db.ts test/localSchemaMigration.test.ts
git status --short
```

Expected: the diff contains only the fixed-column migration, its regression test, and no unrelated changes; the working tree is clean after the implementation commit.
