// In-app accuracy run against the list as loaded, with the bundled negative sample.
import { evalPositives, evalCompanies, evalPeople, combine } from '../core/accuracy.js';
import { setSetting, getSetting } from './db.js';
import { loadIndex } from './screen-index.js';
import { getPolicy } from './screening.js';
import negatives from '../data/negatives.json';
import people from '../data/people-negatives.json';
import offline from '../data/accuracy-offline.json';

const SEED = 11;
const SAMPLE = 1500;
// One part per queue invocation, so a slow site stays inside the consumer's time limit.
export const ACCURACY_STEPS = ['positives', 'companies', 'people'];

export async function runAccuracy(step = 'positives') {
  const cache = await loadIndex();
  if (!cache) throw new Error('The sanctions lists are not loaded yet.');
  const { threshold } = await getPolicy();
  const prior = step === 'positives' ? null : await getSetting('accuracy:partial', null);
  if (step !== 'positives' && (!prior || prior.version !== cache.version || prior.threshold !== threshold)) {
    throw new Error('The lists or the threshold changed while the test ran. Start it again.');
  }
  const partial = prior || { version: cache.version, threshold, startedAt: Date.now() };
  if (step === 'positives') {
    const entries = [...cache.index.byEntry.values()];
    const aliasesById = new Map();
    for (const n of cache.index.names) {
      if (n.primary) continue;
      if (!aliasesById.has(n.entryId)) aliasesById.set(n.entryId, []);
      aliasesById.get(n.entryId).push({ name: n.name });
    }
    partial.positives = evalPositives(cache.index, entries, aliasesById, { threshold, sample: SAMPLE, seed: SEED });
  } else if (step === 'companies') {
    partial.companies = evalCompanies(cache.index, negatives.names, { threshold });
  } else {
    partial.people = evalPeople(cache.index, people.names, { threshold });
  }
  const next = ACCURACY_STEPS[ACCURACY_STEPS.indexOf(step) + 1];
  if (next) {
    await setSetting('accuracy:partial', partial);
    return { next };
  }
  const r = combine({ threshold, seed: SEED, listNames: cache.index.N }, partial.positives, partial.companies, partial.people);
  const seconds = Math.round((Date.now() - partial.startedAt) / 1000);
  await setSetting('accuracy:partial', null);
  const result = {
    threshold, recall: r.recall, total: r.total, positives: r.positives, falsePositiveRate: r.falsePositiveRate, negatives: r.negatives,
    people: r.people, peopleSamples: r.peopleSamples.slice(0, 10),
    avgMs: r.avgMs, queries: r.queries, fpSamples: r.fpSamples.slice(0, 10), misses: r.misses,
    listVersion: cache.version, listPublished: cache.state.published, ukPublished: cache.state.ukPublished || null, euPublished: cache.state.euPublished || null, listNames: r.listNames, at: new Date().toISOString(), seconds,
  };
  await setSetting('accuracy:last', result);
  return { recall: r.recall, falsePositiveRate: r.falsePositiveRate, seconds };
}

export async function accuracyView() {
  return { offline, last: await getSetting('accuracy:last', null), negativesSource: negatives.source, peopleSource: people.source };
}
