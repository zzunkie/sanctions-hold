// Forge SQL schema and small query helpers.
import { sql, migrationRunner } from '@forge/sql';

export const migrations = migrationRunner
  .enqueue('v001_list_entry', `CREATE TABLE IF NOT EXISTS list_entry (
      entry_id VARCHAR(24) PRIMARY KEY,
      list VARCHAR(8) NOT NULL,
      ent_num INT NOT NULL,
      name VARCHAR(600) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      programs VARCHAR(600),
      title VARCHAR(600),
      remarks TEXT,
      aliases TEXT,
      addresses TEXT,
      countries VARCHAR(600),
      hash CHAR(16) NOT NULL,
      added_version VARCHAR(64),
      active TINYINT NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL
    )`)
  .enqueue('v002_list_entry_idx', 'CREATE INDEX IF NOT EXISTS idx_entry_ent ON list_entry (list, ent_num)')
  .enqueue('v003_list_version', `CREATE TABLE IF NOT EXISTS list_version (
      id VARCHAR(64) PRIMARY KEY,
      published VARCHAR(16),
      fetched_at DATETIME NOT NULL,
      entries INT NOT NULL,
      added INT NOT NULL,
      removed INT NOT NULL,
      changed INT NOT NULL,
      note VARCHAR(255)
    )`)
  .enqueue('v004_list_change', `CREATE TABLE IF NOT EXISTS list_change (
      id VARCHAR(36) PRIMARY KEY,
      version_id VARCHAR(64) NOT NULL,
      entry_id VARCHAR(24) NOT NULL,
      change_type VARCHAR(16) NOT NULL,
      name VARCHAR(600),
      programs VARCHAR(600),
      at DATETIME NOT NULL
    )`)
  .enqueue('v005_list_change_idx', 'CREATE INDEX IF NOT EXISTS idx_change_at ON list_change (at)')
  .enqueue('v006_counterparty', `CREATE TABLE IF NOT EXISTS counterparty (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(400) NOT NULL,
      country VARCHAR(8),
      owners TEXT,
      issue_key VARCHAR(32),
      source VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'unscreened',
      approved_at DATETIME,
      approved_by VARCHAR(128),
      screened_at DATETIME,
      screened_version VARCHAR(64),
      created_at DATETIME NOT NULL
    )`)
  .enqueue('v007_counterparty_idx', 'CREATE INDEX IF NOT EXISTS idx_cp_issue ON counterparty (issue_key)')
  .enqueue('v008_hit', `CREATE TABLE IF NOT EXISTS hit (
      counterparty_id VARCHAR(36) NOT NULL,
      entry_id VARCHAR(24) NOT NULL,
      queried_name VARCHAR(400),
      matched_name VARCHAR(600),
      score DECIMAL(4,3) NOT NULL,
      status VARCHAR(16) NOT NULL,
      active TINYINT NOT NULL DEFAULT 1,
      entry_hash CHAR(16),
      found_at DATETIME NOT NULL,
      found_version VARCHAR(64),
      reviewed_by VARCHAR(128),
      reviewed_at DATETIME,
      reason TEXT,
      PRIMARY KEY (counterparty_id, entry_id)
    )`)
  .enqueue('v009_hit_idx', 'CREATE INDEX IF NOT EXISTS idx_hit_status ON hit (status, active)')
  .enqueue('v010_event', `CREATE TABLE IF NOT EXISTS event_log (
      id VARCHAR(36) PRIMARY KEY,
      at DATETIME NOT NULL,
      counterparty_id VARCHAR(36),
      entry_id VARCHAR(24),
      issue_key VARCHAR(32),
      type VARCHAR(32) NOT NULL,
      detail TEXT,
      actor VARCHAR(128)
    )`)
  .enqueue('v011_event_idx', 'CREATE INDEX IF NOT EXISTS idx_event_cp ON event_log (counterparty_id, at)')
  .enqueue('v012_event_at_idx', 'CREATE INDEX IF NOT EXISTS idx_event_at ON event_log (at)')
  .enqueue('v013_setting', `CREATE TABLE IF NOT EXISTS setting (
      k VARCHAR(64) PRIMARY KEY,
      v MEDIUMTEXT
    )`)
  // Vendor-level decision after a confirmed listed minority owner or director: 'proceed' or 'block'.
  .enqueue('v014_cp_decision', 'ALTER TABLE counterparty ADD COLUMN decision VARCHAR(16)')
  .enqueue('v015_cp_decision_reason', 'ALTER TABLE counterparty ADD COLUMN decision_reason TEXT')
  .enqueue('v016_cp_decision_by', 'ALTER TABLE counterparty ADD COLUMN decision_by VARCHAR(128)')
  .enqueue('v017_cp_decision_at', 'ALTER TABLE counterparty ADD COLUMN decision_at DATETIME')
  // The company's registered address and its registration or license number, compared with a list entry's.
  .enqueue('v018_cp_address', 'ALTER TABLE counterparty ADD COLUMN address TEXT')
  .enqueue('v019_cp_reg_no', 'ALTER TABLE counterparty ADD COLUMN reg_no VARCHAR(64)');

let migrated = false;
export async function ensureSchema() {
  if (migrated) return;
  await migrations.run();
  migrated = true;
}

async function run(text, params) {
  const stmt = sql.prepare(text);
  const res = params.length ? await stmt.bindParams(...params).execute() : await stmt.execute();
  return res.rows;
}

// After a long computation the pooled connection to Forge SQL can be closed; the first request then
// fails with "fetch failed" before reaching the database, so it is safe to send once more.
export async function q(text, ...params) {
  try {
    return await run(text, params);
  } catch (e) {
    if (!/fetch failed|ECONNRESET|socket hang up/i.test(`${e?.message} ${e?.cause?.code || ''}`)) throw e;
    return run(text, params);
  }
}

// MySQL DATETIME from an ISO string or Date.
export const dt = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : null);
export const nowDt = () => dt(new Date());
// Back to ISO (Forge SQL returns DATETIME as 'YYYY-MM-DD HH:MM:SS' strings).
export const iso = (v) => (v ? `${String(v).replace(' ', 'T').slice(0, 19)}Z` : null);
export const marks = (n) => new Array(n).fill('?').join(', ');

export async function getSetting(k, fallback) {
  const rows = await q('SELECT v FROM setting WHERE k = ?', k);
  return rows.length ? JSON.parse(rows[0].v) : fallback;
}

export async function setSetting(k, value) {
  await q('INSERT INTO setting (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', k, JSON.stringify(value));
}

const eventRow = (e) => [
  crypto.randomUUID(), dt(e.at || new Date()), e.counterpartyId || null, e.entryId || null, e.issueKey || null,
  e.type, e.detail ? JSON.stringify(e.detail) : null, e.actor || null,
];

export async function logEvent(e) {
  await q('INSERT INTO event_log (id, at, counterparty_id, entry_id, issue_key, type, detail, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...eventRow(e));
}

export async function logEvents(list) {
  await insertMany('event_log', ['id', 'at', 'counterparty_id', 'entry_id', 'issue_key', 'type', 'detail', 'actor'], list.map(eventRow));
}

// Insert rows in chunks that stay under the Forge SQL request size limit (1 MiB).
export async function insertMany(table, columns, rows, { onDuplicate = '' } = {}, maxBytes = 600000) {
  let part = [];
  let bytes = 0;
  const flush = async () => {
    if (!part.length) return;
    const values = part.map(() => `(${marks(columns.length)})`).join(', ');
    await q(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values} ${onDuplicate}`, ...part.flat());
    part = [];
    bytes = 0;
  };
  for (const r of rows) {
    const size = r.reduce((a, v) => a + (v == null ? 4 : String(v).length * 2 + 8), 0);
    if (part.length && (bytes + size > maxBytes || part.length >= 500)) await flush();
    part.push(r);
    bytes += size;
  }
  await flush();
}
