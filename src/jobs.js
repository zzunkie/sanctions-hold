// Queue worker, the hourly list check and the install hook.
import { Queue } from '@forge/events';
import { ensureSchema, getSetting, setSetting, q } from './backend/db.js';
import { importLists, checkForUpdate, listState } from './backend/lists.js';
import { screenCounterparties } from './backend/screening.js';
import { loadSample } from './backend/counterparties.js';
import { runSetup } from './backend/setup.js';
import { startAccuracy, runAccuracyPart } from './backend/accuracy.js';
import { DEMO_HOLD_BACK_FROM } from './core/sample.js';

const queue = new Queue({ key: 'sanctions-jobs' });

export const push = (body, delayInSeconds) => queue.push([{ body, ...(delayInSeconds ? { delayInSeconds } : {}) }]);

// A job in several parts is marked running by its first invocation; the later ones keep that state.
async function track(type, fn, { later = false } = {}) {
  const kept = later && await getSetting(`job:${type}`, null);
  // Each later part refreshes partAt, so a long job in parts is not taken for a dead one.
  const state = kept ? { ...kept, partAt: new Date().toISOString() } : { type, state: 'running', startedAt: new Date().toISOString() };
  await setSetting(`job:${type}`, state);
  try {
    const result = await fn();
    // The job stays running until its last part; a part of a replaced run changes nothing.
    if (result?.next || result?.waiting || result?.superseded) return;
    await setSetting(`job:${type}`, { ...state, state: 'done', finishedAt: new Date().toISOString(), result: result || null });
  } catch (e) {
    console.error(type, e);
    await setSetting(`job:${type}`, { ...state, state: 'error', error: String(e.message).slice(0, 500), finishedAt: new Date().toISOString() });
  }
}

// The queue consumer stops after 15 minutes; a job still marked as running after that has died.
// The accuracy test runs in parts, so it is given longer.
const STALE_MIN = { accuracy: 45 };

export async function jobState(type) {
  const s = await getSetting(`job:${type}`, null);
  const min = STALE_MIN[type] || 16;
  if (s && (s.state === 'running' || s.state === 'queued') && Date.now() - Date.parse(s.partAt || s.startedAt) > min * 60 * 1000) {
    return { ...s, state: 'error', error: `no result after ${min} minutes`, finishedAt: s.startedAt };
  }
  return s;
}

// Screening every vendor again runs in parts of PART vendors, one after another on the queue, so the
// consumer's 15-minute limit does not cap the number of vendors. A site with fewer runs in one go.
const PART = 1000;

async function screenAll(job, reason, extra = {}) {
  const [{ n }] = await q('SELECT COUNT(*) AS n FROM counterparty');
  if (Number(n) <= PART) {
    const s = await screenCounterparties(null, { reason });
    return { ...extra, screened: s.screened || 0, approvedMatched: s.approvedMatched?.length || 0 };
  }
  await push({ type: 'screen-part', job, reason, after: '', totals: {}, extra });
  return { next: true };
}

async function screenPart({ job, reason, after, totals, extra }) {
  const rows = await q(`SELECT id FROM counterparty WHERE id > ? ORDER BY id LIMIT ${PART + 1}`, String(after || ''));
  const ids = rows.slice(0, PART).map((r) => r.id);
  const last = rows.length <= PART;
  const s = ids.length ? await screenCounterparties(ids, { reason, part: { last, before: totals } }) : { screened: 0, newMatches: 0, approvedMatched: [] };
  const t = { screened: (totals.screened || 0) + s.screened, newMatches: (totals.newMatches || 0) + (s.newMatches || 0), approvedMatched: (totals.approvedMatched || 0) + (s.approvedMatched?.length || 0) };
  if (!last) {
    await push({ type: 'screen-part', job, reason, after: ids[ids.length - 1], totals: t, extra });
    return { next: true };
  }
  return { ...extra, screened: t.screened, approvedMatched: t.approvedMatched };
}

export async function queueJob(type, body = {}) {
  await setSetting(`job:${type}`, { type, state: 'queued', startedAt: new Date().toISOString() });
  await push({ type, ...body });
}

export async function hourlyCheck() {
  await ensureSchema();
  // While the sample holds back the newest designations, Replay brings in the latest lists, so the check waits.
  if ((await listState())?.holdBackFrom) return;
  const r = await checkForUpdate();
  if (r.changed) await queueJob('import', { reason: 'new list publication' });
}

export async function worker(event) {
  await ensureSchema();
  const { type } = event.body;
  if (type === 'migrate') return;
  if (type === 'import') {
    await track('import', async () => {
      const r = await importLists({ reason: event.body.reason || 'update', holdBackFrom: event.body.holdBackFrom || null });
      return screenAll('import', `list ${r.version}`, r);
    });
  } else if (type === 'rescreen') {
    await track('rescreen', () => screenAll('rescreen', event.body.reason || 'manual'));
  } else if (type === 'screen-part') {
    await track(event.body.job, () => screenPart(event.body), { later: true });
  } else if (type === 'start-demo') {
    await track('start-demo', async () => {
      const r = (await listState()) ? null : await importLists({ reason: 'demo', holdBackFrom: DEMO_HOLD_BACK_FROM });
      const sample = await loadSample();
      return screenAll('start-demo', 'first screening of existing vendors', { imported: r?.entries || 0, sample: sample.loaded });
    });
  } else if (type === 'setup-jira') {
    await runSetup(event.body);
  } else if (type === 'accuracy') {
    const { runId } = event.body;
    await track('accuracy', async () => {
      if (!runId) {
        const run = await startAccuracy();
        await queue.push(run.parts.map((p) => ({ body: { type: 'accuracy', runId: run.runId, ...p } })));
        return { next: true };
      }
      const r = await runAccuracyPart(event.body);
      if (r.next) await push({ type: 'accuracy', ...r.next });
      return r;
    }, { later: Boolean(runId) });
  }
}

export async function onLifecycle() {
  await push({ type: 'migrate' });
}
