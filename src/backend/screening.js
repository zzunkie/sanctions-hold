// Screen counterparties against the loaded lists and keep the review decisions.
import { screen } from '../core/match.js';
import { reconcile, statusOf } from '../core/decision.js';
import { ownerNames, ownerList, ownerStrings } from '../core/owners.js';
import { listFacts, birthYearClears, normId, countrySpellings } from '../core/evidence.js';
import { MIN_ID } from './screen-index.js';
import { q, marks, insertMany, logEvents, logEvent, getSetting, nowDt } from './db.js';
import { loadIndex } from './screen-index.js';
import { route } from '@forge/api';
import { jira, comment, addLabel, createIssue, setProperty, showPanel, taskType, linkIssues, adf } from './jira.js';
import { setVendorField } from './vendor-field.js';

export const DEFAULT_POLICY = { threshold: 0.92, ownerRule: 'fifty', birthYearRule: false };
export const RULE = 'rule:birth-year';
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

// A list entry that gives the vendor's registration, license or tax number is a possible match under any
// name. The number must be the one registered in the vendor's country: the country written next to it on the
// entry, or else one of the entry's countries.
export function registrationHits(cache, found, { name, registrationNumber, country }) {
  const key = normId(registrationNumber);
  if (!cache?.ids || key.length < MIN_ID) return found;
  const places = country ? countrySpellings(country).concat(String(country).toLowerCase()) : null;
  for (const x of cache.ids.get(key) || []) {
    const e = cache.index.byEntry.get(x.entryId);
    if (!e) continue;
    const where = (x.country || e.countries || '').toLowerCase();
    if (places && where && !places.some((p) => where.includes(p))) continue;
    if (found.has(x.entryId)) continue;
    found.set(x.entryId, { score: 1, matchedName: e.name, queriedName: name, entryHash: e.hash, matchedOn: `${x.label} ${x.value}`.slice(0, 128) });
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

const HIT_COLS = ['counterparty_id', 'entry_id', 'queried_name', 'matched_name', 'score', 'status', 'active', 'entry_hash', 'found_at', 'found_version', 'matched_on'];

// ids: counterparty ids, or null for all. Returns counts and the approved vendors newly matched.
// With `part`, the ids are one part of screening every vendor again: no per-vendor event, and the last part
// records the whole run with the counts of the parts before it.
export async function screenCounterparties(ids = null, { actor = 'app', reason = 'screen', part = null } = {}) {
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
  const newlyHeld = [];
  const ruled = [];
  const unruled = [];
  const ruleNotes = [];
  const founds = cps.map((cp) => registrationHits(cache, screenNames(cache.index, [cp.name, ...ownerNames(cp.owners)], threshold), { name: cp.name, registrationNumber: cp.reg_no, country: cp.country }));
  // Years of birth on the entries matched to an owner or director with a year of birth, for the year-of-birth rule.
  const years = new Map();
  if (policy.birthYearRule) {
    const ids = [...new Set(cps.flatMap((cp, i) => {
      const born = new Set(ownerList(cp.owners).filter((o) => o.born).map((o) => o.name.toLowerCase()));
      return [...founds[i]].filter(([, f]) => born.has(String(f.queriedName).toLowerCase())).map(([id]) => id);
    }))];
    for (const e of await rowsIn('SELECT entry_id, remarks FROM list_entry WHERE entry_id IN (?)', ids)) years.set(e.entry_id, listFacts(e).years);
  }
  for (const [i, cp] of cps.entries()) {
    const own = hitsBy.get(cp.id) || [];
    const found = founds[i];
    const r = reconcile(own, found);
    // Matches the rule cleared before are decided again on every screening; a reviewer's decisions stay.
    const owners = new Map(ownerList(cp.owners).map((o) => [o.name.toLowerCase(), o]));
    const prevOf = new Map(own.map((h) => [h.entry_id, h]));
    const ruledHere = new Set();
    const ruleEvents = [];
    const backHere = [];
    for (const h of r.rows) {
      const prev = prevOf.get(h.entry_id);
      const byRule = prev?.reviewed_by === RULE && prev.status === 'dismissed' && h.status === 'dismissed';
      if (byRule) h.status = 'pending';
      if (h.status !== 'pending' || (prev?.reviewed_by && prev.reviewed_by !== RULE)) continue;
      const o = owners.get(String(h.queried_name).toLowerCase());
      const listed = years.get(h.entry_id) || [];
      if (policy.birthYearRule && o?.born && birthYearClears(o.born, listed)) {
        h.status = 'dismissed';
        ruledHere.add(h.entry_id);
        ruled.push([cp.id, h.entry_id, o.born, listed.join(', ')]);
        if (!byRule) ruleEvents.push({ counterpartyId: cp.id, entryId: h.entry_id, issueKey: cp.issue_key, actor: RULE, type: 'match_dismissed', detail: { matchedName: h.matched_name, score: h.score, reason: `${o.name}, born ${String(o.born).slice(0, 4)}; the list entry gives ${listed.join(', ')}.`, listVersion: version } });
      } else if (byRule) {
        unruled.push([cp.id, h.entry_id]);
        backHere.push({ entryId: h.entry_id, detail: { matchedName: h.matched_name, reason: o?.born ? `${o.name}, born ${String(o.born).slice(0, 4)}.` : `${h.queried_name}.` } });
        r.opened.push({ entryId: h.entry_id, reopened: true, ruleOff: true, matchedName: h.matched_name, queriedName: h.queried_name, score: h.score, entryHash: h.entry_hash });
      }
    }
    const opened = new Set(r.opened.map((o) => o.entryId));
    for (const h of r.rows) {
      const vals = [cp.id, h.entry_id, h.queried_name, h.matched_name, h.score, h.status, 1, h.entry_hash, now, version, h.matched_on || null];
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
        detail: { matchedName: o.matchedName, queriedName: o.queriedName, score: o.score, ...(o.matchedOn ? { matchedOn: o.matchedOn } : {}), ...(o.ruleOff ? { ruleOff: true } : {}), listVersion: version, reason },
      });
    }
    events.push(...ruleEvents);
    // Each line names the entry as the panel does, with the alias it matched on when that differs.
    const noteLine = (e) => {
      const listed = cache.index.byEntry.get(e.entryId)?.name || e.detail.matchedName;
      return `${listed} (${e.entryId}${listed !== e.detail.matchedName ? `, matched on ${e.detail.matchedName}` : ''}): ${e.detail.reason}`;
    };
    const one = (n, a, b) => (n === 1 ? a : b);
    if (cp.issue_key && ruleEvents.length) ruleNotes.push([cp.issue_key, `Sanctions Hold: the year-of-birth rule cleared ${one(ruleEvents.length, 'this possible match', 'these possible matches')}.`, ruleEvents.map(noteLine)]);
    // The rule was turned off, or the year of birth or the entry changed: say on the work item that the match is open again.
    if (cp.issue_key && backHere.length) ruleNotes.push([cp.issue_key, `Sanctions Hold: the year-of-birth rule no longer clears ${one(backHere.length, 'this possible match', 'these possible matches')}, so ${one(backHere.length, 'it is', 'they are')} back for review.`, backHere.map(noteLine)]);
    if (status !== cp.status) events.push({ counterpartyId: cp.id, issueKey: cp.issue_key, actor, type: 'status_changed', detail: { from: cp.status, to: status, listVersion: version } });
    if (ids && !part) events.push({ counterpartyId: cp.id, issueKey: cp.issue_key, actor, type: 'screened', detail: { status, matches: found.size, threshold, listVersion: version, reason } });
    const stillOpen = r.opened.filter((o) => !ruledHere.has(o.entryId));
    if (cp.approved_at && stillOpen.length) approvedMatched.push({ cp, opened: stillOpen });
    else if (cp.issue_key && status !== cp.status && (status === 'blocked' || cp.status === 'blocked' || (!cp.approved_at && status === 'review'))) newlyHeld.push([cp.issue_key, cp.status, status]);
  }
  const update = `ON DUPLICATE KEY UPDATE queried_name = VALUES(queried_name), matched_name = VALUES(matched_name), score = VALUES(score),
                  status = VALUES(status), active = 1, entry_hash = VALUES(entry_hash), matched_on = VALUES(matched_on)`;
  await insertMany('hit', HIT_COLS, fresh, { onDuplicate: `${update}, found_at = VALUES(found_at), found_version = VALUES(found_version)` });
  await insertMany('hit', HIT_COLS, kept, { onDuplicate: update });
  const at = nowDt();
  for (const [cpId, entryId, born, listed] of ruled) {
    await q('UPDATE hit SET reviewed_by = ?, reviewed_at = ?, reason = ? WHERE counterparty_id = ? AND entry_id = ? AND (reviewed_by IS NULL OR reviewed_by = ?)',
      RULE, at, `Year of birth ${String(born).slice(0, 4)}; the list entry gives ${listed}.`, cpId, entryId, RULE);
  }
  for (const [cpId, entryId] of unruled) await q('UPDATE hit SET reviewed_by = NULL, reviewed_at = NULL, reason = NULL WHERE counterparty_id = ? AND entry_id = ? AND reviewed_by = ?', cpId, entryId, RULE);
  for (let i = 0; i < lapsed.length; i += 200) {
    const part = lapsed.slice(i, i + 200);
    await q(`UPDATE hit SET active = 0 WHERE (counterparty_id, entry_id) IN (${part.map(() => '(?, ?)').join(', ')})`, ...part.flat());
  }
  for (let i = 0; i < statuses.length; i += 200) {
    const part = statuses.slice(i, i + 200);
    await q(`UPDATE counterparty SET status = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END, screened_at = ?, screened_version = ?
             WHERE id IN (${marks(part.length)})`, ...part.flat(), now, version, ...part.map((p) => p[0]));
  }
  const newMatches = events.filter((e) => e.type === 'match_found').length;
  if (!ids || part?.last) events.push({ type: 'rescreen_all', actor, detail: { counterparties: (part?.before?.screened || 0) + cps.length, listVersion: version, threshold, reason, newMatches: (part?.before?.newMatches || 0) + newMatches } });
  await logEvents(events);
  for (const [k, head, lines] of ruleNotes) await comment(k, head, ...lines).catch((e) => console.error('rule note', k, e.message));
  for (const m of approvedMatched) await notifyApprovedMatch(m, cache, reason).catch((e) => console.error('notify', m.cp.issue_key, e.message));
  for (const [k, from, to] of newlyHeld) await syncWorkItem(k, from, to).catch((e) => console.error('hold', k, e.message));
  return { screened: cps.length, newMatches, statuses: Object.fromEntries(statuses), approvedMatched: approvedMatched.map((m) => m.cp.id) };
}

// An approved vendor without a work item (approved before Sanctions Hold, or imported) gets one in the
// onboarding project, so that the new match has a place for its review.
async function openReviewItem(cp, imported, cause) {
  const onboarding = await getSetting('onboarding', null);
  if (!onboarding?.projectKey) return null;
  const approved = cp.approved_at ? new Date(cp.approved_at).toISOString().slice(0, 10) : null;
  const issue = await createIssue({
    project: { key: onboarding.projectKey },
    issuetype: { id: onboarding.taskTypeId },
    summary: cp.name.slice(0, 250),
    labels: cp.source === 'sample' ? ['sanctions-hold-sample'] : [],
    description: adf(imported
      ? `Opened by Sanctions Hold for an existing vendor imported from a CSV file${approved ? ` (approved ${approved})` : ''} after screening at import found a possible match.`
      : `Opened by Sanctions Hold for an approved vendor${approved ? ` (approved ${approved})` : ''} that had no onboarding work item, because ${cause} found a possible match.`),
  });
  // Linked first, so the work item's created event finds the vendor instead of adding a second one.
  await q('UPDATE counterparty SET issue_key = ? WHERE id = ?', issue.key, cp.id);
  await setVendorField(issue.key, { country: cp.country, owners: ownerStrings(cp.owners), address: cp.address, registrationNumber: cp.reg_no }).catch((e) => console.error('vendor field', issue.key, e.message));
  await setProperty(issue.key, 'sanctions-hold-counterparty', { counterpartyId: cp.id }).catch(() => null);
  return issue.key;
}

// With a payments project chosen in Settings, an approved vendor's new match also opens a work item there,
// linked to the vendor's work item, so the people who pay the vendor hold payments while it is reviewed.
async function openPaymentHold(cp, lines, cause) {
  const p = await getSetting('paymentHolds', null);
  if (!p?.key) return null;
  const type = await taskType(p.key);
  if (!type) return null;
  const issue = await createIssue({
    project: { key: p.key },
    issuetype: { id: type.id },
    summary: `Hold payments to ${cp.name}`.slice(0, 250),
    description: adf(
      `Sanctions Hold: ${cause} found a possible match for ${cp.name}, an approved vendor. Hold payments to this vendor until the match is reviewed on ${cp.issue_key}.`,
      ...lines,
    ),
  });
  await linkIssues(issue.key, cp.issue_key).catch((e) => console.error('link', issue.key, e.message));
  await logEvent({ type: 'payment_hold_opened', counterpartyId: cp.id, issueKey: cp.issue_key, detail: { workItem: issue.key, project: p.key } });
  return issue.key;
}

// An approved vendor matched by a list update, or an existing vendor matched when it is imported: say so on
// its onboarding work item, and open a payment hold when Settings names a payments project.
async function notifyApprovedMatch({ cp, opened }, cache, reason) {
  const imported = reason === 'imported';
  // A changed threshold or rule in Settings also screens again; say so rather than name a list update.
  const settings = /^(threshold|owner rule|year-of-birth rule) /.test(String(reason || ''));
  const lists = `OFAC ${cache.state.published || 'unknown'}${cache.state.ukPublished ? `, UK ${cache.state.ukPublished}` : ''}${cache.state.euPublished ? `, EU ${cache.state.euPublished}` : ''}`;
  const cause = imported ? 'screening at import' : settings ? 're-screening after a settings change' : 'a sanctions list update';
  if (!cp.issue_key) cp.issue_key = await openReviewItem(cp, imported, cause);
  if (!cp.issue_key) return;
  const lines = opened.map((o) => {
    const e = cache.index.byEntry.get(o.entryId);
    const list = { SDN: 'OFAC SDN List', UK: 'UK Sanctions List', EU: 'EU Consolidated Financial Sanctions List' }[e?.list] || 'OFAC Consolidated Sanctions List';
    return `${o.matchedName} (${list}, ${e?.programs || 'no program given'}${e?.countries ? `; ${e.countries}` : ''}), score ${Number(o.score).toFixed(2)} for "${o.queriedName}"`;
  });
  const hold = await openPaymentHold(cp, lines, cause).catch((e) => { console.error('payment hold', cp.issue_key, e.message); return null; });
  await comment(
    cp.issue_key,
    imported
      ? `Sanctions Hold: screening this imported vendor against the lists updated ${lists} found a possible match.`
      : settings
        ? `Sanctions Hold: re-screening after a settings change found a possible match for this approved vendor on the lists updated ${lists}.`
        : `Sanctions Hold: the latest sanctions list update (${lists}) has a possible match for this approved vendor.`,
    ...lines,
    `The vendor is ${imported ? 'in' : 'back in'} the review queue and this work item has moved to Sanctions review. Review the match in the Sanctions Hold panel.`,
    hold ? `${hold} asks the payments team to hold payments to this vendor.` : null,
  );
  await addLabel(cp.issue_key, 'sanctions-review');
  await moveToReview(cp.issue_key).catch((e) => console.error('hold', cp.issue_key, e.message));
}

// Statuses that hold approval: a vendor waiting for review belongs in "Sanctions review", a blocked one in "Blocked".
export const HELD = new Set(['review', 'blocked']);

async function moveTo(issueKey, statusName) {
  const t = await jira(route`/rest/api/3/issue/${issueKey}/transitions`);
  const tr = (t.transitions || []).find((x) => x.to?.name === statusName);
  if (tr) await jira(route`/rest/api/3/issue/${issueKey}/transitions`, 'POST', { transition: { id: tr.id } });
  await showPanel(issueKey).catch((e) => console.error('panel', issueKey, e.message));
}

// Move a work item to the "Sanctions review" status, where Approve runs the check again.
export const moveToReview = (issueKey) => moveTo(issueKey, 'Sanctions review');

// When the review that a payment hold waits on ends, the hold's open work items say how it ended.
export async function updatePaymentHolds(cp, from, to) {
  if (!cp.issue_key || from !== 'review' || !['cleared', 'blocked'].includes(to)) return;
  const issue = await jira(route`/rest/api/3/issue/${cp.issue_key}?fields=issuelinks`);
  const holds = (issue?.fields?.issuelinks || []).map((l) => l.inwardIssue || l.outwardIssue)
    .filter((i) => i?.fields?.summary?.startsWith('Hold payments to ') && i.fields.status?.statusCategory?.key !== 'done');
  const text = to === 'cleared'
    ? `Sanctions Hold: the review of ${cp.name} on ${cp.issue_key} is complete and the vendor is cleared. Payments to this vendor can resume.`
    : `Sanctions Hold: the review of ${cp.name} on ${cp.issue_key} is complete and the vendor is blocked. Keep payments to this vendor on hold.`;
  for (const h of holds) {
    await comment(h.key, text).catch((e) => console.error('hold update', h.key, e.message));
    // A cleared vendor's hold is done; a blocked vendor's stays open.
    if (to === 'cleared') await closeWorkItem(h.key).catch((e) => console.error('hold close', h.key, e.message));
  }
}

async function closeWorkItem(key) {
  const res = await jira(route`/rest/api/3/issue/${key}/transitions`);
  const done = (res?.transitions || []).find((t) => t.to?.statusCategory?.key === 'done');
  if (done) await jira(route`/rest/api/3/issue/${key}/transitions`, 'POST', { transition: { id: done.id } });
}

// Keep the work item's status in step with the vendor's: Blocked while a confirmed match blocks it,
// back to Sanctions review when a reviewer reopens or changes that decision.
export async function syncWorkItem(issueKey, from, to) {
  if (!issueKey || from === to) return;
  if (to === 'blocked') await moveTo(issueKey, 'Blocked');
  else if (from === 'blocked' || to === 'review') await moveToReview(issueKey);
}
