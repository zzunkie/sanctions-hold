// Accuracy test for the matcher, shared by the offline script and the in-app run.
// Positives: list entries queried by their own name, an alias, and spelling variants of the name.
// Negatives: real legal entity names from GLEIF (public LEI records) that are not on the lists.
import { screen, normalize, tokenize } from './match.js';

export function makeRng(seed = 42) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const TRANSLIT = [
  [/MOHAMMAD|MOHAMMED|MUHAMMAD|MOHAMED/, ['MUHAMMAD', 'MOHAMMED', 'MOHAMAD']],
  [/HOSSEIN|HUSSEIN|HUSAYN/, ['HUSSEIN', 'HOSEIN', 'HUSAIN']],
  [/YUSUF|YOUSEF|YOUSSEF/, ['YOUSSEF', 'YUSOF']],
  [/ABDUL/, ['ABDEL', 'ABD AL']],
  [/SERGEY/, ['SERGEI']], [/ANDREY/, ['ANDREI']], [/DMITRIY|DMITRY/, ['DMITRI']], [/YURIY/, ['YURI']],
  [/ALEKSANDR/, ['ALEXANDER']], [/ALEKSEY/, ['ALEXEI']], [/EVGENIY|YEVGENIY/, ['EVGENY']],
  [/KH/, ['H']], [/OU/, ['U']], [/EE/, ['I']],
];
const TITLES = /^(dr\.?|shaykh|sheikh?|sheik|mullah?|maulana|haj+i|general|colonel|col\.|gen\.|mr\.?|mrs\.?)$/i;
const SUFFIX_SWAP = [' LLC', ' LTD', ' LIMITED', ' CO., LTD.', ' INC', ' JSC', ''];

export function variants(rnd, aliasesById) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  return {
    exact: (e) => e.name,
    // Weak aliases are not searched by the app (see buildIndex), so they are not tested either.
    alias: (e) => { const a = (aliasesById.get(e.id) || []).filter((x) => x.type !== 'weak aka'); return a.length ? pick(a).name : null; },
    // One letter dropped, swapped with the next, or replaced by a vowel, in the longest word.
    typo: (e) => {
      const words = e.name.split(' ');
      const len = (w) => w.replace(/[^A-Z]/gi, '').length;
      const i = words.reduce((b, w, k) => (len(w) > len(words[b]) ? k : b), 0);
      const w = words[i];
      if (w.length < 6) return null;
      const p = 1 + Math.floor(rnd() * (w.length - 2));
      const kind = rnd();
      words[i] = kind < 0.5 ? w.slice(0, p) + w.slice(p + 1) : kind < 0.8 ? w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2) : w.slice(0, p) + 'AEIOU'[Math.floor(rnd() * 5)] + w.slice(p + 1);
      return words.join(' ');
    },
    transliteration: (e) => {
      const u = normalize(e.name);
      for (const [re, outs] of TRANSLIT) if (re.test(u)) return u.replace(new RegExp(re.source, 'g'), pick(outs));
      return null;
    },
    // "LAST, First" as "First Last".
    word_order: (e) => {
      if (e.kind !== 'individual' || !e.name.includes(',')) return null;
      const [last, first] = e.name.split(',').map((s) => s.trim());
      return `${first} ${last}`;
    },
    // An owner written with one given name and the surname: "BOUT, Viktor Anatolijevitch" as
    // "Viktor Bout". Only for listed people with more than one given name.
    given_and_surname: (e) => {
      if (e.kind !== 'individual' || !e.name.includes(',')) return null;
      const [last, first] = e.name.split(',').map((s) => s.trim());
      const given = first.split(/\s+/).filter((w) => !TITLES.test(w));
      return given.length > 1 ? `${given[0]} ${last}` : null;
    },
    legal_suffix: (e) => {
      if (e.kind !== 'entity') return null;
      const base = e.name.replace(/(?:,\s*|\s+)(LLC|L\.L\.C\.|LTD\.?|LIMITED|CO\., LTD\.|INC\.?|OJSC|JSC|OOO|FZE)$/i, '');
      return `${base}${pick(SUFFIX_SWAP)}`.toLowerCase();
    },
  };
}

// entries: [{id, name, kind}], aliasesById: Map id -> [{name}], negatives: [{name, country}] (company
// names); people: optional [{name, country}] person names, counted the same way.
// The test in three parts, so the app can run each part in its own queue invocation:
// list entries searched for in seven forms, then the company names, then the person names.
// The positive searches: random list entries, each in the listed form, an alias and variants. Built
// in full before any search, so a run split over several invocations searches the same list.
export function positiveQueries(entries, aliasesById, { sample = 1500, seed = 42 } = {}) {
  const rnd = makeRng(seed);
  const pool = [...entries];
  const chosen = [];
  while (chosen.length < sample && pool.length) chosen.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const kinds = variants(rnd, aliasesById);
  const list = [];
  for (const e of chosen) {
    for (const [kind, fn] of Object.entries(kinds)) {
      const query = fn(e);
      if (query) list.push({ id: e.id, name: e.name, kind, query });
    }
  }
  return { sample: chosen.length, list };
}

// Runs list[from] onwards until the clock passes `until`, and says where it stopped.
export function evalQueries(index, list, { threshold = 0.92, clock = () => Date.now(), from = 0, until = Infinity } = {}) {
  const positives = {};
  const misses = {};
  let ms = 0;
  let i = from;
  for (; i < list.length && clock() < until; i += 1) {
    const { id, name, kind, query } = list[i];
    const t0 = clock();
    const hits = screen(index, query, { threshold });
    ms += clock() - t0;
    positives[kind] ||= { n: 0, found: 0 };
    positives[kind].n += 1;
    if (hits.some((h) => h.entryId === id)) positives[kind].found += 1;
    else if ((misses[kind] ||= []).length < 5) misses[kind].push({ query, expected: name, top: hits[0] ? `${hits[0].matchedName} ${hits[0].score}` : null });
  }
  return { positives, misses, ms, queries: i - from, next: i };
}

export function evalPositives(index, entries, aliasesById, { threshold = 0.92, sample = 1500, seed = 42, clock = () => Date.now() } = {}) {
  const q = positiveQueries(entries, aliasesById, { sample, seed });
  const r = evalQueries(index, q.list, { threshold, clock });
  return { sample: q.sample, positives: r.positives, misses: r.misses, ms: r.ms, queries: r.queries };
}

// Up to max flagged names, taken a country at a time so that one country does not fill the list.
export function spread(flagged, max = 15) {
  const by = new Map();
  for (const f of flagged) { if (!by.has(f.country)) by.set(f.country, []); by.get(f.country).push(f); }
  const out = [];
  for (let i = 0; out.length < max && [...by.values()].some((l) => l.length > i); i += 1) {
    for (const l of by.values()) if (l[i] && out.length < max) out.push(l[i]);
  }
  return out;
}

const tally = (by, country, flagged) => {
  const c = by[country || '?'] ||= { n: 0, flagged: 0 };
  c.n += 1;
  if (flagged) c.flagged += 1;
};

// A company whose name, without the legal form, equals a list name must be reviewed by any
// screening; it is counted apart from false positives.
export function evalCompanies(index, negatives, { threshold = 0.92, clock = () => Date.now(), from = 0, until = Infinity } = {}) {
  const listNames = new Set(index.names.map((n) => n.tokens.join(' ')));
  const neg = { n: 0, falsePositives: 0, sameName: 0, byCountry: {} };
  const flagged = [];
  const sameSamples = [];
  let ms = 0;
  let queries = 0;
  let i = from;
  for (; i < negatives.length && clock() < until; i += 1) {
    const c = negatives[i];
    if (listNames.has(tokenize(c.name).join(' '))) { neg.sameName += 1; if (sameSamples.length < 5) sameSamples.push(c.name); continue; }
    neg.n += 1;
    const t0 = clock();
    const hits = screen(index, c.name, { threshold });
    ms += clock() - t0;
    queries += 1;
    tally(neg.byCountry, c.country, hits.length > 0);
    if (hits.length) { neg.falsePositives += 1; flagged.push({ name: c.name, country: c.country, matched: hits[0].matchedName, score: hits[0].score }); }
  }
  return { negatives: neg, flagged, fpSamples: spread(flagged), sameSamples, ms, queries, next: i };
}

// A person whose words, in any order, equal a list name ("Wei Zhang" and "ZHANG, Wei") is counted apart.
export function evalPeople(index, people, { threshold = 0.92, clock = () => Date.now(), from = 0, until = Infinity } = {}) {
  const sorted = new Set(index.names.map((n) => [...n.tokens].sort().join(' ')));
  const peopleNeg = { n: 0, falsePositives: 0, sameName: 0, byCountry: {} };
  const flagged = [];
  let ms = 0;
  let queries = 0;
  let i = from;
  for (; i < people.length && clock() < until; i += 1) {
    const p = people[i];
    if (sorted.has([...tokenize(p.name)].sort().join(' '))) { peopleNeg.sameName += 1; continue; }
    peopleNeg.n += 1;
    const t0 = clock();
    const hits = screen(index, p.name, { threshold });
    ms += clock() - t0;
    queries += 1;
    tally(peopleNeg.byCountry, p.country, hits.length > 0);
    if (hits.length) { peopleNeg.falsePositives += 1; flagged.push({ name: p.name, country: p.country, matched: hits[0].matchedName, score: hits[0].score }); }
  }
  return { people: peopleNeg, flagged, peopleSamples: spread(flagged), ms, queries, next: i };
}

const addCounts = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const c = out[k] || {};
    out[k] = Object.fromEntries(Object.keys(v).map((f) => [f, (c[f] || 0) + v[f]]));
  }
  return out;
};

// Adds the result of one slice of a part (positives, companies or people) to the slices before it.
export function mergeSlice(prev, cur) {
  if (!prev) return cur;
  const out = { ...cur, ms: prev.ms + cur.ms, queries: prev.queries + cur.queries };
  if (cur.positives) {
    out.sample = prev.sample;
    out.positives = addCounts(prev.positives, cur.positives);
    out.misses = { ...prev.misses };
    for (const [k, l] of Object.entries(cur.misses)) out.misses[k] = [...(out.misses[k] || []), ...l].slice(0, 5);
  }
  for (const key of ['negatives', 'people']) {
    if (!cur[key]) continue;
    const a = prev[key];
    const b = cur[key];
    out[key] = { n: a.n + b.n, falsePositives: a.falsePositives + b.falsePositives, sameName: a.sameName + b.sameName, byCountry: addCounts(a.byCountry, b.byCountry) };
  }
  if (cur.flagged) {
    out.flagged = [...prev.flagged, ...cur.flagged];
    if (cur.negatives) out.fpSamples = spread(out.flagged);
    if (cur.people) out.peopleSamples = spread(out.flagged);
  }
  if (cur.sameSamples) out.sameSamples = [...prev.sameSamples, ...cur.sameSamples].slice(0, 5);
  return out;
}

// Merges the parts into one result.
export function combine({ threshold, seed, listNames }, pos, comp, ppl) {
  const total = Object.values(pos.positives).reduce((a, p) => ({ n: a.n + p.n, found: a.found + p.found }), { n: 0, found: 0 });
  const ms = pos.ms + comp.ms + (ppl?.ms || 0);
  const queries = pos.queries + comp.queries + (ppl?.queries || 0);
  return {
    threshold, sample: pos.sample, seed, listNames,
    recall: total.n ? total.found / total.n : 0, positives: pos.positives, total,
    falsePositiveRate: comp.negatives.n ? comp.negatives.falsePositives / comp.negatives.n : 0, negatives: comp.negatives,
    people: ppl ? ppl.people : null, peopleFalsePositiveRate: ppl?.people.n ? ppl.people.falsePositives / ppl.people.n : null, peopleSamples: ppl ? ppl.peopleSamples : [],
    avgMs: queries ? ms / queries : 0, queries,
    misses: pos.misses, fpSamples: comp.fpSamples, sameSamples: comp.sameSamples,
  };
}

export function evaluate(index, entries, aliasesById, negatives, { threshold = 0.92, sample = 1500, seed = 42, clock = () => Date.now(), people = null } = {}) {
  const pos = evalPositives(index, entries, aliasesById, { threshold, sample, seed, clock });
  const comp = evalCompanies(index, negatives, { threshold, clock });
  const ppl = people ? evalPeople(index, people, { threshold, clock }) : null;
  return combine({ threshold, seed, listNames: index.N }, pos, comp, ppl);
}
