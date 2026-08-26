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
