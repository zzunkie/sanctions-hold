// Counterparties (vendors and their owners), their possible matches and reviewer decisions.
import { q, dt, nowDt, iso, insertMany, marks, logEvent, logEvents, getSetting } from './db.js';
import { assess } from '../core/decision.js';
import { ownerList, ownerStrings, peopleText } from '../core/owners.js';
import { parseCsv } from '../core/csv.js';
import { sampleVendors } from '../core/sample.js';
import { comment, removeLabel } from './jira.js';
import { syncWorkItem } from './screening.js';

const clean = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const country = (c) => clean(c, 8).toUpperCase() || null;
const owners = (o) => ownerStrings(o).map((s) => clean(s, 200));
const address = (a) => clean(a, 300) || null;
const regNo = (r) => clean(r, 64) || null;
// The date an imported vendor was approved, as YYYY-MM-DD; without one, the import date.
const approvedOn = (d, now) => (/^\d{4}-\d{2}-\d{2}$/.test(clean(d, 10)) && !Number.isNaN(Date.parse(clean(d, 10))) ? dt(clean(d, 10)) : now);
const policy = async () => ({ threshold: 0.92, ownerRule: 'fifty', birthYearRule: false, ...(await getSetting('policy', {})) });

export async function createCounterparty({ name, country: c, owners: o, address: a = null, registrationNumber: r = null, issueKey = null, source, approvedAt = null }, actor = null) {
  const id = crypto.randomUUID();
  const n = clean(name);
  if (!n) throw new Error('A vendor needs a legal name.');
  await q(`INSERT INTO counterparty (id, name, country, owners, address, reg_no, issue_key, source, status, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unscreened', ?, ?)`, id, n, country(c), JSON.stringify(owners(o)), address(a), regNo(r), issueKey, source, dt(approvedAt), nowDt());
  await logEvent({ counterpartyId: id, issueKey, type: 'counterparty_added', detail: { name: n, country: country(c), owners: owners(o), address: address(a), registrationNumber: regNo(r), source }, actor });
  return id;
}

// An address or registration number left undefined keeps the stored one.
export async function updateCounterparty(id, { name, country: c, owners: o, address: a, registrationNumber: r }, actor = null) {
  const n = clean(name);
  if (!n) throw new Error('A vendor needs a legal name.');
  // A changed owner list can change what a confirmed listed owner means, so an earlier proceed/block decision is cleared.
  await q('UPDATE counterparty SET name = ?, country = ?, owners = ?, decision = NULL, decision_reason = NULL WHERE id = ?', n, country(c), JSON.stringify(owners(o)), id);
  if (a !== undefined) await q('UPDATE counterparty SET address = ? WHERE id = ?', address(a), id);
  if (r !== undefined) await q('UPDATE counterparty SET reg_no = ? WHERE id = ?', regNo(r), id);
  await logEvent({ counterpartyId: id, type: 'counterparty_edited', detail: { name: n, country: country(c), owners: owners(o), ...(a !== undefined ? { address: address(a) } : {}), ...(r !== undefined ? { registrationNumber: regNo(r) } : {}) }, actor });
}

export async function byIssue(issueKey) {
  const [cp] = await q('SELECT * FROM counterparty WHERE issue_key = ? ORDER BY created_at DESC LIMIT 1', issueKey);
  return cp || null;
}

const shapeCp = (cp) => ({
  ...cp,
  owners: JSON.parse(cp.owners || '[]'),
  ownerDetails: ownerList(cp.owners),
  registrationNumber: cp.reg_no || null,
  decision_at: iso(cp.decision_at),
  approved_at: iso(cp.approved_at),
  screened_at: iso(cp.screened_at),
  created_at: iso(cp.created_at),
});

// One counterparty with its matches (and the list entry behind each) and its history.
export async function counterpartyView(id) {
  const [cp] = await q('SELECT * FROM counterparty WHERE id = ?', id);
  if (!cp) return null;
  const hits = await q(`SELECT h.*, e.list, e.ent_num, e.name AS entry_name, e.kind, e.programs, e.countries, e.title, e.remarks, e.aliases, e.addresses, e.active AS entry_active
                        FROM hit h LEFT JOIN list_entry e ON e.entry_id = h.entry_id WHERE h.counterparty_id = ? ORDER BY h.score DESC`, id);
  const events = await q('SELECT at, type, entry_id, detail, actor FROM event_log WHERE counterparty_id = ? ORDER BY at DESC LIMIT 50', id);
  const { status, ...assessment } = assess(hits, cp, await policy());
  return {
    counterparty: shapeCp(cp),
    assessment,
    hits: hits.map(shapeHit),
    events: events.map((e) => ({ ...e, at: iso(e.at), detail: JSON.parse(e.detail || 'null') })),
  };
}

export const shapeHit = (h) => ({
  counterpartyId: h.counterparty_id,
  entryId: h.entry_id,
  queriedName: h.queried_name,
  matchedName: h.matched_name,
  matchedOn: h.matched_on || null,
  score: Number(h.score),
  status: h.status,
  active: Boolean(Number(h.active)),
  foundAt: iso(h.found_at),
  foundVersion: h.found_version,
  reviewedBy: h.reviewed_by,
  reviewedAt: iso(h.reviewed_at),
  reason: h.reason,
  entry: h.entry_name ? {
    list: h.list,
    entNum: h.ent_num,
    name: h.entry_name,
    kind: h.kind,
    programs: h.programs,
    countries: h.countries,
    title: h.title,
    remarks: h.remarks,
    aliases: JSON.parse(h.aliases || '[]'),
    addresses: JSON.parse(h.addresses || '[]'),
    onList: Boolean(Number(h.entry_active)),
  } : null,
});

// What the vendor's status means after a decision, for the comment on its work item.
export const NEXT = {
  company: 'Approval stays blocked.',
  'fifty-percent': 'Confirmed OFAC-listed owners hold 50% or more of the company, so it is blocked under OFAC\'s 50 Percent Rule. Approval stays blocked.',
  'uk-majority': 'A confirmed owner listed by the UK holds more than 50% of the company, so it is subject to the UK asset freeze. Approval stays blocked.',
  'eu-ownership': 'Confirmed owners listed by the EU hold 50% or more of the company, so it is subject to the EU asset freeze. Approval stays blocked.',
  'share-unknown': 'The listed owner\'s share is not given, so approval stays blocked until the share is entered.',
  'listed-person': 'Approval stays blocked.',
  minority: 'No ownership rule blocks the vendor automatically. Open Sanctions Hold from the work item\'s Apps button to decide whether to proceed or block.',
  pending: 'Other possible matches still wait for review.',
  review: 'Other possible matches still wait for review.',
  blocked: 'Approval stays blocked.',
  cleared: 'No match waits for review; the vendor can be approved.',
  clear: 'No match waits for review; the vendor can be approved.',
};

// After a confirmed listed minority owner or director: proceed (approval allowed) or block.
export async function decideCounterparty({ counterpartyId, decision, reason }, accountId) {
  if (!['proceed', 'block'].includes(decision)) throw new Error('Unknown decision.');
  const why = clean(reason, 2000);
  if (why.length < 5) throw new Error('Write the reason for the decision; it goes into the audit record.');
  const [cp] = await q('SELECT * FROM counterparty WHERE id = ?', counterpartyId);
  if (!cp) throw new Error('This vendor is no longer on record.');
  const all = await q('SELECT entry_id, status, active, queried_name FROM hit WHERE counterparty_id = ?', counterpartyId);
  const before = assess(all, cp, await policy());
  if (!['minority', 'reviewer-proceeded', 'reviewer-blocked'].includes(before.reason)) throw new Error('This vendor does not need a proceed or block decision.');
  await q('UPDATE counterparty SET decision = ?, decision_reason = ?, decision_by = ?, decision_at = ? WHERE id = ?', decision, why, accountId, nowDt(), counterpartyId);
  const { status } = assess(all, { ...cp, decision }, await policy());
  await q('UPDATE counterparty SET status = ? WHERE id = ?', status, counterpartyId);
  const people = peopleText(before.people);
  await logEvents([
    { counterpartyId, issueKey: cp.issue_key, type: `vendor_${decision === 'proceed' ? 'proceeded' : 'blocked'}`, detail: { people, share: before.share, reason: why }, actor: accountId },
    ...(status !== cp.status ? [{ counterpartyId, issueKey: cp.issue_key, type: 'status_changed', detail: { from: cp.status, to: status }, actor: accountId }] : []),
  ]);
  if (cp.issue_key) {
    await comment(cp.issue_key, [`Sanctions Hold: listed ${people} ${decision === 'proceed' ? 'noted; the vendor may proceed' : 'blocks this vendor'}, decided by `, { mention: accountId }, '.'], `Reason: ${why}`,
      decision === 'proceed' ? 'The vendor can be approved.' : 'Approval stays blocked.').catch((e) => console.error('comment', e.message));
    await removeLabel(cp.issue_key, 'sanctions-review').catch(() => null);
  }
  await syncWorkItem(cp.issue_key, cp.status, status).catch((e) => console.error('status', cp.issue_key, e.message));
  return { status };
}

// decision: 'dismissed' (not the same party), 'confirmed' (same party), 'pending' (reopen).
export async function reviewMatch({ counterpartyId, entryId, decision, reason }, accountId) {
  if (!['dismissed', 'confirmed', 'pending'].includes(decision)) throw new Error('Unknown decision.');
  const why = clean(reason, 2000);
  if (decision !== 'pending' && why.length < 5) throw new Error('Write the reason for the decision; it goes into the audit record.');
  const [h] = await q('SELECT * FROM hit WHERE counterparty_id = ? AND entry_id = ?', counterpartyId, entryId);
  if (!h) throw new Error('This match is no longer on record.');
  await q('UPDATE hit SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ? WHERE counterparty_id = ? AND entry_id = ?',
    decision, accountId, nowDt(), why || null, counterpartyId, entryId);
  const [cp] = await q('SELECT * FROM counterparty WHERE id = ?', counterpartyId);
  const all = await q('SELECT entry_id, status, active, queried_name FROM hit WHERE counterparty_id = ?', counterpartyId);
  const { status, reason: why2 } = assess(all, cp, await policy());
  await q('UPDATE counterparty SET status = ? WHERE id = ?', status, counterpartyId);
  await logEvents([
    { counterpartyId, entryId, issueKey: cp.issue_key, type: `match_${decision}`, detail: { matchedName: h.matched_name, score: Number(h.score), reason: why, from: h.status }, actor: accountId },
    ...(status !== cp.status ? [{ counterpartyId, issueKey: cp.issue_key, type: 'status_changed', detail: { from: cp.status, to: status }, actor: accountId }] : []),
  ]);
  if (cp.issue_key && decision !== 'pending') {
    const verb = decision === 'dismissed' ? 'not the same party' : 'confirmed as the same party';
    await comment(cp.issue_key, [`Sanctions Hold: possible match ${h.matched_name} (${entryId}) marked ${verb} by `, { mention: accountId }, '.'], `Reason: ${why}`, NEXT[why2] || NEXT[status])
      .catch((e) => console.error('comment', e.message));
    if (status !== 'review') await removeLabel(cp.issue_key, 'sanctions-review').catch(() => null);
  }
  await syncWorkItem(cp.issue_key, cp.status, status).catch((e) => console.error('status', cp.issue_key, e.message));
  return { status };
}

export async function listCounterparties({ status = null, search = '', limit = 100, offset = 0 }) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) { where.push('(name LIKE ? OR owners LIKE ? OR issue_key LIKE ?)'); const s = `%${clean(search, 100)}%`; params.push(s, s, s); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await q(`SELECT * FROM counterparty ${w} ORDER BY FIELD(status, 'blocked', 'review', 'unscreened', 'cleared', 'clear'), name LIMIT ${lim} OFFSET ${off}`, ...params);
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM counterparty ${w}`, ...params);
  return { rows: rows.map(shapeCp), total: Number(n) };
}

// Possible matches waiting for a reviewer, with the list entry behind each.
const queueRows = async (where, order) => (await q(`SELECT h.*, c.name AS cp_name, c.country AS cp_country, c.owners AS cp_owners, c.address AS cp_address, c.reg_no AS cp_reg_no, c.issue_key, c.approved_at, e.list, e.ent_num, e.name AS entry_name, e.kind,
                               e.programs, e.countries, e.title, e.remarks, e.aliases, e.addresses, e.active AS entry_active
                        FROM hit h JOIN counterparty c ON c.id = h.counterparty_id LEFT JOIN list_entry e ON e.entry_id = h.entry_id
                        WHERE ${where} AND h.active = 1 ORDER BY ${order} LIMIT 200`))
  .map((r) => ({ ...shapeHit(r), counterparty: { id: r.counterparty_id, name: r.cp_name, country: r.cp_country, owners: JSON.parse(r.cp_owners || '[]'), address: r.cp_address || null, registrationNumber: r.cp_reg_no || null, issueKey: r.issue_key, approvedAt: iso(r.approved_at) } }));

export const reviewQueue = () => queueRows("h.status = 'pending'", 'c.approved_at IS NULL, h.found_at DESC, h.score DESC');

// Matches the year-of-birth rule cleared, for a reviewer to check, for example when a year of birth was typed wrong.
export const ruleCleared = () => queueRows("h.status = 'dismissed' AND h.reviewed_by = 'rule:birth-year'", 'h.reviewed_at DESC');

// CSV: name, country, owners (owners separated by ";"), and optionally address and registration number. A header row is optional.
export async function importCsv(text, actor) {
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim()));
  if (rows.length && /^(name|vendor|legal)/i.test(String(rows[0][0]).trim())) rows.shift();
  const now = nowDt();
  // An import is the list of vendors already in use, so each one counts as approved: a possible match
  // then opens a work item in the onboarding project, now or after a later list update.
  const list = rows.map((r) => ({ name: clean(r[0]), country: country(r[1]), owners: owners(r[2]), address: address(r[3]), regNo: regNo(r[4]), approvedAt: approvedOn(r[5], now) })).filter((r) => r.name);
  if (!list.length) throw new Error('No vendor names found. Columns: name, country, owners.');
  if (list.length > 5000) throw new Error('Up to 5,000 vendors per file.');
  const ids = list.map(() => crypto.randomUUID());
  await insertMany('counterparty', ['id', 'name', 'country', 'owners', 'address', 'reg_no', 'issue_key', 'source', 'status', 'approved_at', 'created_at'],
    list.map((r, i) => [ids[i], r.name, r.country, JSON.stringify(r.owners), r.address, r.regNo, null, 'csv', 'unscreened', r.approvedAt, now]));
  await logEvent({ type: 'counterparties_imported', detail: { count: list.length }, actor });
  return ids;
}

export async function loadSample() {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM counterparty WHERE source = 'sample'");
  if (Number(n)) return { loaded: 0 };
  const list = sampleVendors();
  const now = nowDt();
  await insertMany('counterparty', ['id', 'name', 'country', 'owners', 'address', 'reg_no', 'issue_key', 'source', 'status', 'approved_at', 'created_at'],
    list.map((v) => [`sample-${v.key}`, v.name, v.country, JSON.stringify(v.owners), v.address || null, v.registrationNumber || null, null, 'sample', 'unscreened', dt(v.approvedAt), now]));
  await logEvent({ type: 'sample_loaded', detail: { count: list.length }, actor: 'app' });
  return { loaded: list.length };
}

export async function removeSample() {
  await q("DELETE FROM hit WHERE counterparty_id LIKE 'sample-%'");
  await q("DELETE FROM counterparty WHERE source = 'sample'");
}

export async function counts() {
  const rows = await q('SELECT status, COUNT(*) AS n, SUM(CASE WHEN approved_at IS NOT NULL THEN 1 ELSE 0 END) AS approved FROM counterparty GROUP BY status');
  const out = { total: 0, approvedInReview: 0 };
  for (const r of rows) {
    out[r.status] = Number(r.n);
    out.total += Number(r.n);
    if (r.status === 'review' || r.status === 'blocked') out.approvedInReview += Number(r.approved);
  }
  return out;
}

const csvCell = (v) => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Audit record as CSV: every screening, match, decision, approval and list update.
export async function auditCsv({ days = 90 } = {}) {
  const since = dt(Date.now() - Math.min(366, Math.max(1, Number(days) || 90)) * 864e5);
  const rows = await q(`SELECT l.at, l.type, l.issue_key, c.name AS counterparty, l.entry_id, l.actor, l.detail
                        FROM event_log l LEFT JOIN counterparty c ON c.id = l.counterparty_id
                        WHERE l.at >= ? ORDER BY l.at DESC LIMIT 5000`, since);
  const head = ['time_utc', 'event', 'work_item', 'counterparty', 'list_entry', 'actor', 'detail'];
  return [head.join(','), ...rows.map((r) => [iso(r.at), r.type, r.issue_key, r.counterparty, r.entry_id, r.actor, r.detail].map(csvCell).join(','))].join('\n');
}

export { marks };
