// In-app accuracy run against the list as loaded, with the bundled negative sample.
import { evaluate } from '../core/accuracy.js';
import { setSetting, getSetting } from './db.js';
import { loadIndex } from './screen-index.js';
import { getPolicy } from './screening.js';
import negatives from '../data/negatives.json';
import people from '../data/people-negatives.json';
import offline from '../data/accuracy-offline.json';

export async function runAccuracy() {
  const cache = await loadIndex();
  if (!cache) throw new Error('The sanctions lists are not loaded yet.');
  const { threshold } = await getPolicy();
  const entries = [...cache.index.byEntry.values()];
  const aliasesById = new Map();
  for (const n of cache.index.names) {
    if (n.primary) continue;
    if (!aliasesById.has(n.entryId)) aliasesById.set(n.entryId, []);
    aliasesById.get(n.entryId).push({ name: n.name });
  }
  const started = Date.now();
  const r = evaluate(cache.index, entries, aliasesById, negatives.names, { threshold, sample: 1500, seed: 11, people: people.names });
  const seconds = Math.round((Date.now() - started) / 1000);
  const result = {
    threshold, recall: r.recall, total: r.total, positives: r.positives, falsePositiveRate: r.falsePositiveRate, negatives: r.negatives,
    people: r.people, peopleSamples: r.peopleSamples.slice(0, 10),
    avgMs: r.avgMs, queries: r.queries, fpSamples: r.fpSamples.slice(0, 10), misses: r.misses,
    listVersion: cache.version, listPublished: cache.state.published, ukPublished: cache.state.ukPublished || null, listNames: r.listNames, at: new Date().toISOString(), seconds,
  };
  await setSetting('accuracy:last', result);
  return { recall: r.recall, falsePositiveRate: r.falsePositiveRate, seconds };
}

export async function accuracyView() {
  return { offline, last: await getSetting('accuracy:last', null), negativesSource: negatives.source, peopleSource: people.source };
}
