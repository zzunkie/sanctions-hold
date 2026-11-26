// In-app accuracy run against the list as loaded, with the bundled negative sample.
import { positiveQueries, evalQueries, evalCompanies, evalPeople, combine, mergeSlice, afterBirthYearRule } from '../core/accuracy.js';
import { listFacts } from '../core/evidence.js';
import { q, marks, setSetting, getSetting } from './db.js';
import { loadIndex } from './screen-index.js';
import { getPolicy } from './screening.js';
import negatives from '../data/negatives.json';
import people from '../data/people-negatives.json';
import offline from '../data/accuracy-offline.json';

const SEED = 11;
const SAMPLE = 1500;
// The test runs as parts on the queue at the same time. Each part searches until BUDGET_MS after it
// started and hands the rest of its slice to the next invocation, so a slow site stays inside the
// consumer's 15-minute limit. The part that finds every other part done adds them up.
export const ACCURACY_STEPS = ['positives', 'companies', 'people'];
const BUDGET_MS = 9 * 60 * 1000;
const PART_SIZE = 1150;
const partKey = (i) => `accuracy:part:${i}`;

function stepInput(cache, step) {
  if (step === 'positives') {
    const entries = [...cache.index.byEntry.values()];
    const aliasesById = new Map();
    for (const n of cache.index.names) {
      if (n.primary) continue;
      if (!aliasesById.has(n.entryId)) aliasesById.set(n.entryId, []);
      aliasesById.get(n.entryId).push({ name: n.name });
    }
    const pq = positiveQueries(entries, aliasesById, { sample: SAMPLE, seed: SEED });
    return { n: pq.list.length, sample: pq.sample, run: (o) => evalQueries(cache.index, pq.list, o) };
  }
  if (step === 'companies') return { n: negatives.names.length, run: (o) => evalCompanies(cache.index, negatives.names, o) };
  return { n: people.names.length, run: (o) => evalPeople(cache.index, people.names, o) };
}

async function current() {
  const cache = await loadIndex();
  if (!cache) throw new Error('The sanctions lists are not loaded yet.');
  const { threshold } = await getPolicy();
  return { cache, threshold };
}

// Starts a run and returns its parts for the queue. A run started later replaces this one.
export async function startAccuracy() {
  const { cache, threshold } = await current();
  const parts = [];
  for (const step of ACCURACY_STEPS) {
    const { n } = stepInput(cache, step);
    const size = Math.ceil(n / Math.ceil(n / PART_SIZE));
    for (let from = 0; from < n; from += size) parts.push({ part: parts.length, step, from, to: Math.min(n, from + size) });
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await q("DELETE FROM setting WHERE k LIKE 'accuracy:part:%'");
  await setSetting('accuracy:run', { runId, version: cache.version, threshold, startedAt: Date.now(), parts: parts.length });
  return { runId, parts };
}

export async function runAccuracyPart({ runId, part, step, from, to, at = null }) {
  const until = Date.now() + BUDGET_MS;
  const run = await getSetting('accuracy:run', null);
  if (run?.runId !== runId) return { superseded: true };
  const { cache, threshold } = await current();
  if (run.version !== cache.version || run.threshold !== threshold) {
    throw new Error('The lists or the threshold changed while the test ran. Start it again.');
  }
  const input = stepInput(cache, step);
  const prior = at === null ? null : await getSetting(partKey(part), null);
  const r = input.run({ threshold, from: at ?? from, to, until });
  if (step === 'positives') r.sample = input.sample;
  const result = mergeSlice(prior?.runId === runId ? prior.result : null, r);
  const done = r.next >= to;
  await setSetting(partKey(part), { runId, step, from, done, result });
  if (!done) return { next: { runId, part, step, from, to, at: r.next } };
  const rows = await q("SELECT v FROM setting WHERE k LIKE 'accuracy:part:%'");
  const all = rows.map((x) => JSON.parse(x.v)).filter((x) => x.runId === runId && x.done);
  if (all.length < run.parts) return { waiting: true };
  return finish(run, cache, all);
}

async function finish(run, cache, all) {
  const { threshold } = run;
  const merged = (step) => all.filter((x) => x.step === step).sort((a, b) => a.from - b.from).reduce((acc, x) => mergeSlice(acc, x.result), null);
  const ppl = merged('people');
  const res = combine({ threshold, seed: SEED, listNames: cache.index.N }, merged('positives'), merged('companies'), ppl);
  // The year-of-birth rule needs the dates of birth in the list entries' remarks, which the name index leaves out.
  const ids = [...new Set((ppl?.flagged || []).flatMap((f) => f.entryIds || []))];
  const years = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    for (const e of await q(`SELECT entry_id, remarks FROM list_entry WHERE entry_id IN (${marks(part.length)})`, ...part)) years.set(e.entry_id, listFacts(e).years);
  }
  const yearRule = ppl ? afterBirthYearRule(ppl.flagged, (id) => years.get(id) || []) : null;
  const seconds = Math.round((Date.now() - run.startedAt) / 1000);
  const result = {
    threshold, recall: res.recall, total: res.total, positives: res.positives, falsePositiveRate: res.falsePositiveRate, negatives: res.negatives,
    people: res.people, peopleSamples: res.peopleSamples.slice(0, 10), peopleAfterBirthYearRule: yearRule,
    avgMs: res.avgMs, queries: res.queries, fpSamples: res.fpSamples.slice(0, 10), misses: res.misses,
    listVersion: cache.version, listPublished: cache.state.published, ukPublished: cache.state.ukPublished || null, euPublished: cache.state.euPublished || null, listNames: res.listNames, at: new Date().toISOString(), seconds,
  };
  await setSetting('accuracy:last', result);
  return { recall: res.recall, falsePositiveRate: res.falsePositiveRate, seconds };
}

export async function accuracyView() {
  return { offline, last: await getSetting('accuracy:last', null), negativesSource: negatives.source, peopleSource: people.source };
}
