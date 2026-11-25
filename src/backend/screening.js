// Screen counterparties against the loaded lists and keep the review decisions.
import { screen } from '../core/match.js';
import { reconcile, statusOf } from '../core/decision.js';
import { ownerNames } from '../core/owners.js';
import { q, marks, insertMany, logEvents, getSetting, nowDt } from './db.js';
import { loadIndex } from './screen-index.js';
import { route } from '@forge/api';
import { jira, comment, addLabel } from './jira.js';

export const DEFAULT_POLICY = { threshold: 0.92, ownerRule: 'fifty' };
export async function getPolicy() {
  return { ...DEFAULT_POLICY, ...(await getSetting('policy', {})) };
}


// Best match per list entry over the company name and the owner names.
export function screenNames(index, names, threshold) {
  const found = new Map();
  for (const name of names) {
    for (const h of screen(index, name, { threshold, limit: 10 })) {
      const prev = found.get(h.entryId);
      if (!prev || h.score > prev.score) {
        found.set(h.entryId, { score: h.score, matchedName: h.matchedName, queriedName: name, entryHash: index.byEntry.get(h.entryId)?.hash || null });
      }
    }
  }
  return found;
}

async function rowsIn(sqlText, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    out.push(...await q(sqlText.replace('(?)', `(${marks(part.length)})`), ...part));
  }
  return out;
}

const HIT_COLS = ['counterparty_id', 'entry_id', 'queried_name', 'matched_name', 'score', 'status', 'active', 'entry_hash', 'found_at', 'found_version'];

// ids: counterparty ids, or null for all. Returns counts and the approved vendors newly matched.
export async function screenCounterparties(ids = null, { actor = 'app', reason = 'screen' } = {}) {
  const cache = await loadIndex();
  if (!cache) return { skipped: 'The sanctions lists are not loaded yet.' };
  const policy = await getPolicy();
  const { threshold } = policy;
  const cps = ids ? await rowsIn('SELECT * FROM counterparty WHERE id IN (?)', ids) : await q('SELECT * FROM counterparty');
  if (!cps.length) return { screened: 0 };
  const hits = ids ? await rowsIn('SELECT * FROM hit WHERE counterparty_id IN (?)', ids) : await q('SELECT * FROM hit');
  const hitsBy = new Map();
  for (const h of hits) {
    if (!hitsBy.has(h.counterparty_id)) hitsBy.set(h.counterparty_id, []);
    hitsBy.get(h.counterparty_id).push(h);
  }
  const now = nowDt();
  const version = cache.version;
  const fresh = [];
  const kept = [];
  const lapsed = [];
  const events = [];
  const statuses = [];
  const approvedMatched = [];
  for (const cp of cps) {
    const own = hitsBy.get(cp.id) || [];
    const found = screenNames(cache.index, [cp.name, ...ownerNames(cp.owners)], threshold);
    const r = reconcile(own, found);
    const opened = new Set(r.opened.map((o) => o.entryId));
    for (const h of r.rows) {
      const vals = [cp.id, h.entry_id, h.queried_name, h.matched_name, h.score, h.status, 1, h.entry_hash, now, version];
      (opened.has(h.entry_id) ? fresh : kept).push(vals);
    }
    for (const e of r.lapsed) lapsed.push([cp.id, e]);
    const after = [
      ...own.filter((h) => !found.has(h.entry_id)).map((h) => ({ ...h, active: r.lapsed.includes(h.entry_id) ? 0 : h.active })),
      ...r.rows,
    ];
    const status = statusOf(after, cp, policy);
    statuses.push([cp.id, status]);
    for (const o of r.opened) {
      events.push({
        counterpartyId: cp.id, entryId: o.entryId, issueKey: cp.issue_key, actor,
        type: o.reopened ? 'match_reopened' : 'match_found',
        detail: { matchedName: o.matchedName, queriedName: o.queriedName, score: o.score, listVersion: version, reason },
      });
    }
    if (status !== cp.status) events.push({ counterpartyId: cp.id, issueKey: cp.issue_key, actor, type: 'status_changed', detail: { from: cp.status, to: status, listVersion: version } });
    if (ids) events.push({ counterpartyId: cp.id, issueKey: cp.issue_key, actor, type: 'screened', detail: { status, matches: found.size, threshold, listVersion: version, reason } });
    if (cp.approved_at && r.opened.length) approvedMatched.push({ cp, opened: r.opened });
  }
  const update = `ON DUPLICATE KEY UPDATE queried_name = VALUES(queried_name), matched_name = VALUES(matched_name), score = VALUES(score),
                  status = VALUES(status), active = 1, entry_hash = VALUES(entry_hash)`;
  await insertMany('hit', HIT_COLS, fresh, { onDuplicate: `${update}, found_at = VALUES(found_at), found_version = VALUES(found_version)` });
  await insertMany('hit', HIT_COLS, kept, { onDuplicate: update });
  for (let i = 0; i < lapsed.length; i += 200) {
    const part = lapsed.slice(i, i + 200);
    await q(`UPDATE hit SET active = 0 WHERE (counterparty_id, entry_id) IN (${part.map(() => '(?, ?)').join(', ')})`, ...part.flat());
  }
  for (let i = 0; i < statuses.length; i += 200) {
    const part = statuses.slice(i, i + 200);
    await q(`UPDATE counterparty SET status = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END, screened_at = ?, screened_version = ?
             WHERE id IN (${marks(part.length)})`, ...part.flat(), now, version, ...part.map((p) => p[0]));
  }
  if (!ids) events.push({ type: 'rescreen_all', actor, detail: { counterparties: cps.length, listVersion: version, threshold, reason, newMatches: events.filter((e) => e.type === 'match_found').length } });
  await logEvents(events);
  for (const m of approvedMatched) await notifyApprovedMatch(m, cache).catch((e) => console.error('notify', m.cp.issue_key, e.message));
  return { screened: cps.length, statuses: Object.fromEntries(statuses), approvedMatched: approvedMatched.map((m) => m.cp.id) };
}

// An approved vendor matched by a list update: say so on its onboarding work item.
async function notifyApprovedMatch({ cp, opened }, cache) {
  if (!cp.issue_key) return;
  const lines = opened.map((o) => {
    const e = cache.index.byEntry.get(o.entryId);
    const list = e?.list === 'SDN' ? 'OFAC SDN List' : e?.list === 'UK' ? 'UK Sanctions List' : 'OFAC Consolidated Sanctions List';
    return `${o.matchedName} (${list}, ${e?.programs || 'no program given'}${e?.countries ? `; ${e.countries}` : ''}), score ${Number(o.score).toFixed(2)} for "${o.queriedName}"`;
  });
  await comment(
    cp.issue_key,
    `Sanctions Hold: the latest sanctions list update (OFAC ${cache.state.published || 'unknown'}${cache.state.ukPublished ? `, UK ${cache.state.ukPublished}` : ''}) has a possible match for this approved vendor.`,
    ...lines,
    'The vendor is back in the review queue and this work item moves to Sanctions review. Decide in the Sanctions Hold panel whether it is the same party.',
  );
  await addLabel(cp.issue_key, 'sanctions-review');
  await holdApproval(cp.issue_key).catch((e) => console.error('hold', cp.issue_key, e.message));
}

// Move an approved work item to the "Sanctions review" status, where Approve runs the check again.
async function holdApproval(issueKey) {
  const t = await jira(route`/rest/api/3/issue/${issueKey}/transitions`);
  const hold = (t.transitions || []).find((x) => x.to?.name === 'Sanctions review');
  if (hold) await jira(route`/rest/api/3/issue/${issueKey}/transitions`, 'POST', { transition: { id: hold.id } });
}
