# Local Schema Migration for Missing `folder_id`

## Problem

Existing PGlite databases can have encrypted record tables created before the
`folder_id` column was introduced. The current `CREATE TABLE IF NOT EXISTS`
statements do not alter those existing tables, so repository queries against
legacy `tasks` (and other affected tables) fail with `column "folder_id" does
not exist`.

## Goal

Make local schema initialization backward-compatible without deleting or
rewriting existing vault data.

## Design

Keep the current `CREATE TABLE IF NOT EXISTS` definitions for fresh databases.
After table creation, run idempotent additive migrations for the affected
encrypted record tables:

- `folders`
- `credentials`
- `notes`
- `tasks`
- `income`
- `activity_log`

Each migration adds `folder_id TEXT` only when the column is absent. Existing
rows retain their IDs, timestamps, tombstones, and encrypted payloads; their
new column value is `NULL`. `app_settings` is excluded because its repository
contract has no folder relationship.

The migration runs inside `initSchema`, before owner policies are created and
before any repository or sync query can execute. PGlite initialization errors
continue to reject initialization; the app must not reset the local database
as a recovery strategy.

No Supabase migration is required because the reported failure is against the
local PGlite database, while the hosted schema already contains
`vault_records.folder_id`.

## Testing

Add a regression test for a legacy local schema that creates `tasks` without
`folder_id`, runs schema initialization, and verifies the column exists. Also
verify the migration is idempotent and that existing task data remains
readable. Run the full test suite, typecheck, lint, and production build.

## Scope

This change is limited to local schema compatibility. It does not change
record encryption, repository APIs, sync wire formats, data reset behavior, or
the hosted Supabase schema.
