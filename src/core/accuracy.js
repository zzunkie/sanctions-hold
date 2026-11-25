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
export function evalPositives(index, entries, aliasesById, { threshold = 0.92, sample = 1500, seed = 42, clock = () => Date.now() } = {}) {
  const rnd = makeRng(seed);
  const pool = [...entries];
  const chosen = [];
  while (chosen.length < sample && pool.length) chosen.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  const kinds = variants(rnd, aliasesById);
  const positives = {};
  const misses = {};
  let ms = 0;
  let queries = 0;
  for (const e of chosen) {
    for (const [k, fn] of Object.entries(kinds)) {
      const query = fn(e);
      if (!query) continue;
      const t0 = clock();
      const hits = screen(index, query, { threshold });
      ms += clock() - t0;
      queries += 1;
      positives[k] ||= { n: 0, found: 0 };
      positives[k].n += 1;
      if (hits.some((h) => h.entryId === e.id)) positives[k].found += 1;
      else if ((misses[k] ||= []).length < 5) misses[k].push({ query, expected: e.name, top: hits[0] ? `${hits[0].matchedName} ${hits[0].score}` : null });
    }
  }
  return { sample: chosen.length, positives, misses, ms, queries };
}

// A company whose name, without the legal form, equals a list name must be reviewed by any
// screening; it is counted apart from false positives.
export function evalCompanies(index, negatives, { threshold = 0.92, clock = () => Date.now() } = {}) {
  const listNames = new Set(index.names.map((n) => n.tokens.join(' ')));
  const neg = { n: 0, falsePositives: 0, sameName: 0 };
  const fpSamples = [];
  const sameSamples = [];
  let ms = 0;
  let queries = 0;
  for (const c of negatives) {
    if (listNames.has(tokenize(c.name).join(' '))) { neg.sameName += 1; if (sameSamples.length < 5) sameSamples.push(c.name); continue; }
    neg.n += 1;
    const t0 = clock();
    const hits = screen(index, c.name, { threshold });
    ms += clock() - t0;
    queries += 1;
    if (hits.length) { neg.falsePositives += 1; if (fpSamples.length < 15) fpSamples.push({ name: c.name, country: c.country, matched: hits[0].matchedName, score: hits[0].score }); }
  }
  return { negatives: neg, fpSamples, sameSamples, ms, queries };
}

// A person whose words, in any order, equal a list name ("Wei Zhang" and "ZHANG, Wei") is counted apart.
export function evalPeople(index, people, { threshold = 0.92, clock = () => Date.now() } = {}) {
  const sorted = new Set(index.names.map((n) => [...n.tokens].sort().join(' ')));
  const peopleNeg = { n: 0, falsePositives: 0, sameName: 0 };
  const peopleSamples = [];
  let ms = 0;
  let queries = 0;
  for (const p of people) {
    if (sorted.has([...tokenize(p.name)].sort().join(' '))) { peopleNeg.sameName += 1; continue; }
    peopleNeg.n += 1;
    const t0 = clock();
    const hits = screen(index, p.name, { threshold });
    ms += clock() - t0;
    queries += 1;
    if (hits.length) { peopleNeg.falsePositives += 1; if (peopleSamples.length < 15) peopleSamples.push({ name: p.name, country: p.country, matched: hits[0].matchedName, score: hits[0].score }); }
  }
  return { people: peopleNeg, peopleSamples, ms, queries };
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
