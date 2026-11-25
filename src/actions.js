// Rovo / MCP tools. Inputs come from a language model, so they are used as names to screen, as
// lookup keys, or as the fields of a new onboarding request; decisions stay with Jira reviewers.
import { route } from '@forge/api';
import { ensureSchema, q, iso, dt, logEvent, getSetting } from './backend/db.js';
import { loadIndex } from './backend/screen-index.js';
import { screenNames, getPolicy, screenCounterparties } from './backend/screening.js';
import { counterpartyView, createCounterparty } from './backend/counterparties.js';
import { jira, adf, setProperty } from './backend/jira.js';
import { setVendorField } from './backend/vendor-field.js';
import { CP_PROPERTY } from './backend/setup.js';
import { ownerList, ownerStrings } from './core/owners.js';
import { COUNTRIES } from './core/countries.js';
import { compact } from './core/match.js';

const LIST_NAMES = { SDN: 'OFAC SDN List', CONS: 'OFAC Consolidated Sanctions List', UK: 'UK Sanctions List' };
const text = (v, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const trimStop = (v) => String(v ?? '').trim().replace(/[.\s]+$/, '');
const STATUS_TEXT = {
  clear: 'no possible match on the lists as loaded; Sanctions Hold does not hold its approval',
  cleared: 'every possible match was reviewed and dismissed, or a reviewer let a listed minority owner or director proceed; Sanctions Hold does not hold its approval',
  review: 'a possible match or a reviewer decision is pending; approval is held',
  blocked: 'a reviewer confirmed a sanctions list match for this vendor or one of its owners; approval stays blocked in Jira',
  unscreened: 'not screened yet',
};

// Owners arrive as "Ali Kalhor 60%; Sara Haddad director", or separated by commas when there is no ";".
const ownersFrom = (v) => {
  const raw = String(v ?? '');
  return ownerList(raw.includes(';') || raw.includes('\n') ? raw : raw.replace(/,(?![^(]*\))/g, ';'));
};
const BY_COUNTRY = new Map(COUNTRIES.flatMap(([code, name]) => [[code.toLowerCase(), code], [name.toLowerCase(), code]]));
const countryCode = (v) => BY_COUNTRY.get(text(v, 60).toLowerCase()) || null;

// A vendor already in Sanctions Hold under the same name, written with or without its legal form
// ("Lowlands Metal Trading" and "Lowlands Metal Trading B.V.").
async function findKnown(name, { withIssue = false } = {}) {
  const first = name.split(/\s+/)[0].replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await q(`SELECT id, name, status, issue_key, owners FROM counterparty WHERE LOWER(name) LIKE LOWER(?)${withIssue ? ' AND issue_key IS NOT NULL' : ''} ORDER BY created_at DESC LIMIT 100`, `${first}%`);
  const key = compact(name);
  return rows.find((r) => r.name === name) || rows.find((r) => compact(r.name) === key) || null;
}

export async function screenCounterparty(payload) {
  await ensureSchema();
  const name = text(payload?.name);
  if (!name) return { error: 'Give the legal name of the company or person to screen.' };
  const given = ownersFrom(payload?.owners).map((o) => o.name).slice(0, 10);
  const cache = await loadIndex();
  if (!cache) return { error: 'The sanctions lists are not loaded in Sanctions Hold yet.' };
  const { threshold } = await getPolicy();
  // A vendor already in Sanctions Hold is screened with the owners and directors on its record too,
  // so a call that gives the name alone gets the same matches as the vendor's work item.
  const known = await findKnown(name);
  const stored = known ? ownerList(known.owners).map((o) => o.name) : [];
  const owners = [...given, ...stored.filter((o) => !given.some((g) => compact(g) === compact(o)))].slice(0, 20);
  const reviewed = known ? new Map((await counterpartyView(known.id)).hits.filter((h) => h.status !== 'pending').map((h) => [h.entryId, h.status])) : new Map();
  const found = screenNames(cache.index, [name, ...owners], threshold);
  const country = text(payload?.country, 60) || null;
  const matches = [...found.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 10).map(([entryId, f]) => {
    const e = cache.index.byEntry.get(entryId);
    return {
      listEntry: entryId, list: LIST_NAMES[e?.list] || e?.list, name: e?.name, matchedOn: f.matchedName,
      screenedName: f.queriedName, score: f.score, programs: e?.programs || null, countries: e?.countries || null, type: e?.kind,
      reviewed: reviewed.get(entryId) || null,
    };
  });
  const open = matches.filter((m) => !m.reviewed);
  const confirmed = matches.filter((m) => m.reviewed === 'confirmed');
  const REVIEWED = { confirmed: ', confirmed by a reviewer', dismissed: ', dismissed by a reviewer as not the same party' };
  await logEvent({ counterpartyId: known?.id || null, type: 'screened_by_tool', detail: { name, owners, country, matches: matches.length, threshold, listVersion: cache.version }, actor: 'mcp' });
  const answer = matches.length
    ? `${open.length ? 'Possible match' : 'Reviewed match'} for "${name}": ${matches.slice(0, 3).map((m) => `${m.screenedName !== name ? `owner or director ${m.screenedName} ~ ` : ''}${m.name} (${m.list}, ${m.programs || 'no program given'}${m.countries ? `; ${m.countries}` : ''}), score ${Number(m.score).toFixed(2)}${REVIEWED[m.reviewed] || ''}`).join('; ')}.${open.length ? ' A reviewer compares the details in Sanctions Hold to decide whether it is the same party.' : ''}`
    : `No match for "${name}"${owners.length ? ` or its owners (${owners.join(', ')})` : ''} on the OFAC SDN and Consolidated lists as updated on ${cache.state.published}${cache.state.ukPublished ? ` or the UK Sanctions List as updated on ${cache.state.ukPublished}` : ''}.`;
  // A known vendor is answered from its record first, where the reviewers' decisions are.
  const knownText = known ? `${known.name} is already a vendor in Sanctions Hold${known.issue_key ? ` (${known.issue_key})` : ''}: ${STATUS_TEXT[known.status] || known.status}.${stored.length ? ` Screened with the owners and directors on its record (${stored.join(', ')}).` : ''} ` : '';
  return {
    answer: knownText + answer, result: open.length ? 'possible_match' : confirmed.length ? 'confirmed_match' : 'no_match', threshold,
    listPublished: cache.state.published, ukListPublished: cache.state.ukPublished || null, listVersion: cache.version, screenedOwners: owners, matches,
    knownCounterparty: known ? { name: known.name, status: known.status, meaning: STATUS_TEXT[known.status], workItem: known.issue_key } : null,
  };
}

export async function counterpartyStatus(payload) {
  await ensureSchema();
  const key = text(payload?.counterparty, 200);
  if (!key) return { error: 'Give a vendor name or a work item key such as VEND-12.' };
  const isIssue = /^[A-Z][A-Z0-9_]+-\d+$/i.test(key);
  const rows = isIssue
    ? await q('SELECT id FROM counterparty WHERE issue_key = ? ORDER BY created_at DESC LIMIT 1', key.toUpperCase())
    : await q('SELECT id FROM counterparty WHERE name = ? OR name LIKE ? ORDER BY name = ? DESC, created_at DESC LIMIT 3', key, `%${key}%`, key);
  if (!rows.length) return { found: false, answer: `No vendor "${key}" in Sanctions Hold. Use screen-counterparty to check a new name.` };
  const v = await counterpartyView(rows[0].id);
  const cp = v.counterparty;
  const open = v.hits.filter((h) => h.status === 'confirmed' || (h.status === 'pending' && h.active));
  const reviewed = v.hits.filter((h) => h.status === 'dismissed');
  const approval = v.events.find((e) => e.type === 'approved');
  const answer = `${cp.name}${cp.issue_key ? ` (${cp.issue_key})` : ''}: ${STATUS_TEXT[cp.status] || cp.status}.`
    + (open.length ? ` ${open.map((h) => (h.status === 'confirmed' ? `Confirmed: ${h.matchedName} (${trimStop(h.reason)})` : `Waiting for review: ${h.matchedName}, score ${Number(h.score).toFixed(2)}`)).join('; ')}.` : '')
    + (reviewed.length ? ` Dismissed after review: ${reviewed.map((h) => `${h.matchedName} (${trimStop(h.reason)})`).join('; ')}.` : '')
    + (cp.screened_at ? ` Last screened ${cp.screened_at.slice(0, 16).replace('T', ' ')} UTC.` : '');
  return {
    found: true, answer, name: cp.name, country: cp.country, owners: cp.owners, workItem: cp.issue_key, status: cp.status, meaning: STATUS_TEXT[cp.status],
    approvedAt: cp.approved_at, lastScreenedAt: cp.screened_at, listVersion: cp.screened_version,
    matches: v.hits.map((h) => ({ listEntry: h.entryId, name: h.entry?.name || h.matchedName, score: h.score, status: h.status, onList: h.entry?.onList ?? null, reviewedAt: h.reviewedAt, reason: h.reason })),
    lastApproval: approval ? { at: approval.at, by: approval.actor } : null,
    otherMatches: rows.length > 1 ? rows.length - 1 : 0,
  };
}

export async function listChanges(payload) {
  await ensureSchema();
  const days = Math.min(90, Math.max(1, Number(payload?.days) || 7));
  const since = dt(Date.now() - days * 864e5);
  const versions = await q('SELECT id, published, fetched_at, entries, added, removed, changed, note FROM list_version WHERE fetched_at >= ? ORDER BY fetched_at DESC', since);
  const changes = await q('SELECT change_type, entry_id, name, programs FROM list_change WHERE at >= ? ORDER BY at DESC LIMIT 200', since);
  const matched = await q(`SELECT c.name, c.issue_key, c.status, c.approved_at, h.matched_name, h.score, h.entry_id FROM hit h JOIN counterparty c ON c.id = h.counterparty_id
                           WHERE h.found_at >= ? AND h.status = 'pending' AND h.active = 1 ORDER BY c.approved_at IS NULL, h.score DESC LIMIT 50`, since);
  const count = (t) => changes.filter((c) => c.change_type === t).length;
  const approved = matched.filter((m) => m.approved_at);
  // The first import of a site has no list changes; it is not counted as an update.
  const updates = versions.filter((v) => v.added || v.removed || v.changed);
  const answer = versions.length
    ? `${updates.length ? `In the last ${days} days Sanctions Hold loaded ${updates.length} sanctions list ${updates.length === 1 ? 'update' : 'updates'}: ${count('added')} entries added, ${count('removed')} removed, ${count('changed')} changed.` : `In the last ${days} days Sanctions Hold loaded the sanctions lists for the first time and no update has come since.`} `
      + (approved.length ? `${approved.length} approved ${approved.length === 1 ? 'vendor now has' : 'vendors now have'} a possible match: ${approved.map((m) => `${m.name}${m.issue_key ? ` (${m.issue_key})` : ''} ~ ${m.matched_name}`).join('; ')}.` : 'No approved vendor gained a possible match.')
    : `No sanctions list update was loaded in the last ${days} days.`;
  return {
    answer, days,
    updates: versions.map((v) => ({ version: v.id, published: v.published, loadedAt: iso(v.fetched_at), entries: v.entries, added: v.added, removed: v.removed, changed: v.changed, note: v.note })),
    added: changes.filter((c) => c.change_type === 'added').slice(0, 50).map((c) => ({ listEntry: c.entry_id, name: c.name, programs: c.programs })),
    removed: changes.filter((c) => c.change_type === 'removed').slice(0, 50).map((c) => ({ listEntry: c.entry_id, name: c.name })),
    newPossibleMatches: matched.map((m) => ({ vendor: m.name, workItem: m.issue_key, approved: Boolean(m.approved_at), listEntry: m.entry_id, matchedName: m.matched_name, score: Number(m.score) })),
  };
}

// Open an onboarding request in Jira for a counterparty that is not known yet. It is screened at once;
// approval then follows the project's Approve transition and the reviewers' decisions.
export async function requestApproval(payload, context) {
  await ensureSchema();
  const name = text(payload?.name, 250);
  if (!name) return { error: 'Give the legal name of the company or person.' };
  const onboarding = await getSetting('onboarding', null);
  if (!onboarding?.projectKey) return { error: 'Sanctions Hold has no onboarding project on this site yet. A Jira admin creates it on the Sanctions Hold page.' };
  const known = await findKnown(name, { withIssue: true });
  if (known) {
    return { answer: `${known.name} already has an onboarding request, ${known.issue_key}: ${STATUS_TEXT[known.status] || known.status}.`, workItem: known.issue_key, status: known.status, created: false };
  }
  const owners = ownerStrings(ownersFrom(payload?.owners));
  const country = countryCode(payload?.country);
  const note = text(payload?.note, 1000);
  const accountId = context?.principal?.accountId || payload?.context?.principal?.accountId || null;
  const issue = await jira(route`/rest/api/3/issue`, 'POST', {
    fields: {
      project: { key: onboarding.projectKey },
      issuetype: { id: onboarding.taskTypeId },
      summary: `New vendor: ${name}`.slice(0, 250),
      description: adf(accountId ? ['Requested in Rovo or an MCP client by ', { mention: accountId }, '.'] : 'Requested in Rovo or an MCP client.', note ? `Note: ${note}` : null),
    },
  });
  await setVendorField(issue.key, { country, owners }).catch((e) => console.error('vendor field', e.message));
  const id = await createCounterparty({ name, country, owners, issueKey: issue.key, source: 'mcp' }, accountId || 'mcp');
  await setProperty(issue.key, CP_PROPERTY, { counterpartyId: id }).catch(() => null);
  await screenCounterparties([id], { actor: accountId || 'mcp', reason: 'requested through MCP' });
  const v = await counterpartyView(id);
  const cp = v.counterparty;
  const open = v.hits.filter((h) => h.status === 'pending' && h.active);
  return {
    answer: `Opened ${issue.key} for ${name}. ${open.length ? `It has ${open.length} possible ${open.length === 1 ? 'match' : 'matches'} (${open.map((h) => h.matchedName).join('; ')}), so approval is held until a reviewer decides in Jira.` : 'No possible match on the lists as loaded; the request waits for approval in Jira.'}`,
    created: true, workItem: issue.key, status: cp.status, meaning: STATUS_TEXT[cp.status], country, owners,
    matches: open.map((h) => ({ listEntry: h.entryId, name: h.entry?.name || h.matchedName, screenedName: h.queriedName, score: h.score })),
  };
}
