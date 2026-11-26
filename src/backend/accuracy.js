// In-app accuracy run against the list as loaded, with the bundled negative sample.
import { positiveQueries, evalQueries, evalCompanies, evalPeople, combine, mergeSlice } from '../core/accuracy.js';
import { setSetting, getSetting } from './db.js';
import { loadIndex } from './screen-index.js';
import { getPolicy } from './screening.js';
import negatives from '../data/negatives.json';
import people from '../data/people-negatives.json';
import offline from '../data/accuracy-offline.json';

const SEED = 11;
const SAMPLE = 1500;
// Each queue invocation searches until BUDGET_MS after it started and hands the rest of its part to
// the next one, so a slow site stays inside the consumer's 15-minute limit.
export const ACCURACY_STEPS = ['positives', 'companies', 'people'];
const BUDGET_MS = 9 * 60 * 1000;

export async function runAccuracy(step = 'positives', cont = false, runId = null) {
  const until = Date.now() + BUDGET_MS;
  const cache = await loadIndex();
  if (!cache) throw new Error('The sanctions lists are not loaded yet.');
  const { threshold } = await getPolicy();
  const prior = cont ? await getSetting('accuracy:partial', null) : null;
  // A run started later replaces this one; its parts stop here.
  if (cont && prior?.runId !== runId) return { superseded: true };
  if (cont && (!prior || prior.version !== cache.version || prior.threshold !== threshold)) {
    throw new Error('The lists or the threshold changed while the test ran. Start it again.');
  }
  const partial = prior || { version: cache.version, threshold, startedAt: Date.now(), runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  const from = partial.step === step ? partial.next || 0 : 0;
  let r;
  let total;
  if (step === 'positives') {
    const entries = [...cache.index.byEntry.values()];
    const aliasesById = new Map();
    for (const n of cache.index.names) {
      if (n.primary) continue;
      if (!aliasesById.has(n.entryId)) aliasesById.set(n.entryId, []);
      aliasesById.get(n.entryId).push({ name: n.name });
    }
    const q = positiveQueries(entries, aliasesById, { sample: SAMPLE, seed: SEED });
    r = { sample: q.sample, ...evalQueries(cache.index, q.list, { threshold, from, until }) };
    total = q.list.length;
  } else if (step === 'companies') {
    r = evalCompanies(cache.index, negatives.names, { threshold, from, until });
    total = negatives.names.length;
  } else {
    r = evalPeople(cache.index, people.names, { threshold, from, until });
    total = people.names.length;
  }
  partial[step] = mergeSlice(from ? partial[step] : null, r);
  const next = r.next < total ? step : ACCURACY_STEPS[ACCURACY_STEPS.indexOf(step) + 1];
  if (next) {
    partial.step = next;
    partial.next = next === step ? r.next : 0;
    await setSetting('accuracy:partial', partial);
    return { next, runId: partial.runId };
  }
  const res = combine({ threshold, seed: SEED, listNames: cache.index.N }, partial.positives, partial.companies, partial.people);
  const seconds = Math.round((Date.now() - partial.startedAt) / 1000);
  await setSetting('accuracy:partial', null);
  const result = {
    threshold, recall: res.recall, total: res.total, positives: res.positives, falsePositiveRate: res.falsePositiveRate, negatives: res.negatives,
    people: res.people, peopleSamples: res.peopleSamples.slice(0, 10),
    avgMs: res.avgMs, queries: res.queries, fpSamples: res.fpSamples.slice(0, 10), misses: res.misses,
    listVersion: cache.version, listPublished: cache.state.published, ukPublished: cache.state.ukPublished || null, euPublished: cache.state.euPublished || null, listNames: res.listNames, at: new Date().toISOString(), seconds,
  };
  await setSetting('accuracy:last', result);
  return { recall: res.recall, falsePositiveRate: res.falsePositiveRate, seconds };
}

export async function accuracyView() {
  return { offline, last: await getSetting('accuracy:last', null), negativesSource: negatives.source, peopleSource: people.source };
}
