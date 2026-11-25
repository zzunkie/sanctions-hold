// Queue worker, the hourly list check and the install hook.
import { Queue } from '@forge/events';
import { ensureSchema, getSetting, setSetting } from './backend/db.js';
import { importLists, checkForUpdate, listState } from './backend/lists.js';
import { screenCounterparties } from './backend/screening.js';
import { loadSample } from './backend/counterparties.js';
import { runSetup } from './backend/setup.js';
import { runAccuracy } from './backend/accuracy.js';
import { DEMO_HOLD_BACK_FROM } from './core/sample.js';

const queue = new Queue({ key: 'sanctions-jobs' });

export const push = (body, delayInSeconds) => queue.push([{ body, ...(delayInSeconds ? { delayInSeconds } : {}) }]);

async function track(type, fn) {
  const state = { type, state: 'running', startedAt: new Date().toISOString() };
  await setSetting(`job:${type}`, state);
  try {
    const result = await fn();
    await setSetting(`job:${type}`, { ...state, state: 'done', finishedAt: new Date().toISOString(), result: result || null });
  } catch (e) {
    console.error(type, e);
    await setSetting(`job:${type}`, { ...state, state: 'error', error: String(e.message).slice(0, 500), finishedAt: new Date().toISOString() });
  }
}

export async function jobState(type) {
  return getSetting(`job:${type}`, null);
}

export async function queueJob(type, body = {}) {
  await setSetting(`job:${type}`, { type, state: 'queued', startedAt: new Date().toISOString() });
  await push({ type, ...body });
}

export async function hourlyCheck() {
  await ensureSchema();
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
      const s = await screenCounterparties(null, { reason: `list ${r.version}` });
      return { ...r, screened: s.screened || 0, approvedMatched: s.approvedMatched?.length || 0 };
    });
  } else if (type === 'rescreen') {
    await track('rescreen', () => screenCounterparties(null, { reason: event.body.reason || 'manual' }));
  } else if (type === 'start-demo') {
    await track('start-demo', async () => {
      const r = (await listState()) ? null : await importLists({ reason: 'demo', holdBackFrom: DEMO_HOLD_BACK_FROM });
      const sample = await loadSample();
      const s = await screenCounterparties(null, { reason: 'first screening of existing vendors' });
      return { imported: r?.entries || 0, sample: sample.loaded, screened: s.screened || 0 };
    });
  } else if (type === 'setup-jira') {
    await runSetup(event.body);
  } else if (type === 'accuracy') {
    await track('accuracy', () => runAccuracy());
  }
}

export async function onLifecycle() {
  await push({ type: 'migrate' });
}
