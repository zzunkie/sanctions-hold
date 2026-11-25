// Resolvers for the global page and the issue panel.
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { ensureSchema, q, iso, getSetting, setSetting } from './backend/db.js';
import { listState } from './backend/lists.js';
import {
  counts, listCounterparties, counterpartyView, reviewQueue, reviewMatch, createCounterparty, updateCounterparty,
  byIssue, importCsv, removeSample, auditCsv, decideCounterparty,
} from './backend/counterparties.js';
import { setVendorField } from './backend/vendor-field.js';
import { screenCounterparties, getPolicy } from './backend/screening.js';
import { setupStatus, CP_PROPERTY } from './backend/setup.js';
import { setProperty, listProjects } from './backend/jira.js';
import { accuracyView } from './backend/accuracy.js';
import { queueJob, jobState, push } from './jobs.js';
import { nameFromSummary, detailsFromDescription } from './events.js';

const resolver = new Resolver();
const define = (name, fn) => resolver.define(name, async (req) => {
  await ensureSchema();
  try {
    return { ok: true, ...(await fn(req.payload || {}, req.context)) };
  } catch (e) {
    console.error(name, e);
    return { ok: false, error: e.message };
  }
});
const decodeUpload = (data) => Buffer.from(String(data).replace(/^data:[^,]*,/, ''), 'base64').toString('utf8');
const JOBS = ['import', 'rescreen', 'start-demo', 'accuracy'];

define('overview', async () => {
  const [c, list, check, setup, onboarding, queue, recent] = await Promise.all([
    counts(), listState(), getSetting('listCheck', null), setupStatus(), getSetting('onboarding', null), reviewQueue(),
    q(`SELECT l.at, l.type, l.issue_key, l.entry_id, l.detail, l.actor, c.name FROM event_log l LEFT JOIN counterparty c ON c.id = l.counterparty_id
       WHERE l.type IN ('match_found', 'match_reopened', 'match_dismissed', 'match_confirmed', 'approval_blocked', 'approved', 'list_updated', 'rescreen_all', 'screened_by_tool', 'review_note_added')
          OR (l.type = 'counterparty_added' AND (l.detail LIKE '%"source":"mcp"%' OR l.detail LIKE '%"source":"rovo"%'))
       ORDER BY l.at DESC LIMIT 15`),
  ]);
  const jobs = Object.fromEntries(await Promise.all(JOBS.map(async (j) => [j, await jobState(j)])));
  return {
    counts: c, list, check, setup, onboarding, jobs, policy: await getPolicy(),
    approvedMatched: queue.filter((h) => h.counterparty.approvedAt),
    waiting: queue.length,
    recent: recent.map((r) => ({ ...r, at: iso(r.at), detail: JSON.parse(r.detail || 'null') })),
  };
});

define('jobs', async () => ({ jobs: Object.fromEntries(await Promise.all(JOBS.map(async (j) => [j, await jobState(j)]))), setup: await setupStatus() }));
define('startDemo', async () => { await queueJob('start-demo'); return {}; });
define('loadLists', async () => { await queueJob('import', { reason: 'first import' }); return {}; });
define('updateNow', async () => { await queueJob('import', { reason: 'manual' }); return {}; });
define('replayDesignations', async () => {
  const s = await listState();
  if (!s?.holdBackFrom) throw new Error('No designations are held back.');
  await queueJob('import', { reason: 'demo replay of the newest designations' });
  return {};
});
define('rescreenAll', async () => { await queueJob('rescreen', { reason: 'manual' }); return {}; });
define('removeSample', async () => { await removeSample(); return {}; });

define('reviewQueue', async () => ({ rows: await reviewQueue() }));
define('review', async ({ counterpartyId, entryId, decision, reason }, ctx) => reviewMatch({ counterpartyId, entryId, decision, reason }, ctx.accountId));
define('decideVendor', async ({ counterpartyId, decision, reason }, ctx) => decideCounterparty({ counterpartyId, decision, reason }, ctx.accountId));

define('listCounterparties', async (p) => listCounterparties(p));
define('getCounterparty', async ({ id }) => ({ view: await counterpartyView(id) }));
define('addCounterparty', async ({ name, country, owners }, ctx) => {
  const id = await createCounterparty({ name, country, owners, source: 'manual' }, ctx.accountId);
  await screenCounterparties([id], { actor: ctx.accountId, reason: 'added' });
  return { view: await counterpartyView(id) };
});
define('editCounterparty', async ({ id, name, country, owners }, ctx) => {
  await updateCounterparty(id, { name, country, owners }, ctx.accountId);
  await screenCounterparties([id], { actor: ctx.accountId, reason: 'edited' });
  return { view: await counterpartyView(id) };
});
define('screenAgain', async ({ id }, ctx) => {
  await screenCounterparties([id], { actor: ctx.accountId, reason: 'screen again' });
  return { view: await counterpartyView(id) };
});
define('importCsv', async ({ data }, ctx) => {
  const ids = await importCsv(decodeUpload(data), ctx.accountId);
  if (ids.length <= 300) await screenCounterparties(ids, { actor: ctx.accountId, reason: 'imported' });
  else await queueJob('rescreen', { reason: 'imported' });
  return { imported: ids.length, queued: ids.length > 300 };
});

define('listUpdates', async () => {
  const versions = await q('SELECT * FROM list_version ORDER BY fetched_at DESC LIMIT 30');
  const changes = await q(`SELECT ch.version_id, ch.change_type, ch.entry_id, ch.name, ch.programs, e.countries, e.kind FROM list_change ch
                           LEFT JOIN list_entry e ON e.entry_id = ch.entry_id ORDER BY ch.at DESC LIMIT 300`);
  const matched = await q(`SELECT h.found_version, h.entry_id, h.matched_name, h.score, h.status, c.id, c.name, c.issue_key, c.approved_at
                           FROM hit h JOIN counterparty c ON c.id = h.counterparty_id
                           WHERE h.found_version IN (SELECT id FROM list_version) ORDER BY h.found_at DESC LIMIT 300`);
  return {
    list: await listState(),
    check: await getSetting('listCheck', null),
    versions: versions.map((v) => ({ ...v, fetched_at: iso(v.fetched_at) })),
    changes,
    matched: matched.map((m) => ({ ...m, approved_at: iso(m.approved_at), score: Number(m.score) })),
  };
});

define('accuracy', async () => accuracyView());
define('runAccuracy', async () => { await queueJob('accuracy'); return {}; });

define('getSettings', async () => ({ policy: await getPolicy(), projects: await getSetting('projects', []), available: await listProjects().catch(() => []) }));
define('saveSettings', async ({ threshold, projects, ownerRule }, ctx) => {
  const t = Number(threshold);
  if (!(t >= 0.85 && t <= 0.98)) throw new Error('The threshold must be between 0.85 and 0.98.');
  const before = await getPolicy();
  const rule = ownerRule === 'any' ? 'any' : 'fifty';
  await setSetting('policy', { ...before, threshold: t, ownerRule: rule });
  if (rule !== before.ownerRule) await queueJob('rescreen', { reason: `owner rule ${before.ownerRule} -> ${rule} by ${ctx.accountId}` });
  if (Array.isArray(projects)) await setSetting('projects', projects.map((p) => String(p).toUpperCase()).slice(0, 20));
  if (t !== before.threshold) await queueJob('rescreen', { reason: `threshold ${before.threshold} -> ${t} by ${ctx.accountId}` });
  return {};
});
define('setupJira', async (_, ctx) => {
  await setSetting('setup', { state: 'running', steps: ['Queued'], startedAt: new Date().toISOString() });
  await push({ type: 'setup-jira', accountId: ctx.accountId });
  return {};
});
define('setupStatus', async () => ({ setup: await setupStatus() }));
define('auditCsv', async ({ days }) => ({ csv: await auditCsv({ days }) }));

// Issue panel
async function issueFields(issueKey) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,project`);
  if (!res.ok) return null;
  return (await res.json()).fields;
}

define('issueView', async ({ issueKey }) => {
  const cp = await byIssue(issueKey);
  if (cp) return { view: await counterpartyView(cp.id), list: await listState() };
  const f = await issueFields(issueKey);
  return { view: null, list: await listState(), suggestion: f ? { name: nameFromSummary(f.summary), ...detailsFromDescription(f.description) } : null };
});
define('issueSetVendor', async ({ issueKey, name, country, owners }, ctx) => {
  const cp = await byIssue(issueKey);
  let id = cp?.id;
  if (cp) await updateCounterparty(cp.id, { name, country, owners }, ctx.accountId);
  else {
    id = await createCounterparty({ name, country, owners, issueKey, source: 'jira' }, ctx.accountId);
    await setProperty(issueKey, CP_PROPERTY, { counterpartyId: id }).catch(() => null);
  }
  await screenCounterparties([id], { actor: ctx.accountId, reason: cp ? 'edited in panel' : 'added in panel' });
  await setVendorField(issueKey, { country, owners }).catch((e) => console.error('vendor field', e.message));
  return { view: await counterpartyView(id) };
});

export const handler = resolver.getDefinitions();

// Status on the collapsed "Sanctions Hold" panel in the work item's sidebar.
const CONTEXT_STATUS = {
  blocked: ['Blocked', 'removed'],
  review: ['Waiting for review', 'moved'],
  cleared: ['Cleared', 'success'],
  clear: ['No match', 'success'],
  unscreened: ['Not screened', 'default'],
};
export async function contextStatus(payload) {
  await ensureSchema();
  const key = payload?.extension?.issue?.key || payload?.context?.extension?.issue?.key || payload?.issue?.key;
  const cp = key ? await byIssue(key) : null;
  const [label, type] = CONTEXT_STATUS[cp?.status || 'unscreened'] || CONTEXT_STATUS.unscreened;
  return { status: { type: 'lozenge', value: { label, type } } };
}
