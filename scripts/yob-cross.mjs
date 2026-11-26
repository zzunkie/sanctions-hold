// The year-of-birth rule on people listed by two sources: the year from one list as the owner's year,
// checked against the other list's entry. A clear here would drop a real listed person.
// usage: node scripts/yob-cross.mjs <dir with OFAC CSV exports> <UK-Sanctions-List.xml> <eu.xml>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const APP = new URL('../src/', import.meta.url).href;
const { LISTS } = await import(APP + 'core/ofac.js');
const { parseUkXml } = await import(APP + 'core/uk.js');
const { parseEuXml } = await import(APP + 'core/eu.js');
const { buildRecords } = await import(APP + 'core/records.js');
const { listFacts, birthYearClears } = await import(APP + 'core/evidence.js');
const { normalize } = await import(APP + 'core/match.js');
const [ofacDir, ukPath, euPath] = process.argv.slice(2);
const read = (f) => readFileSync(join(ofacDir, f), 'latin1');
const files = Object.fromEntries(Object.entries(LISTS).map(([list, l]) => [list, { prim: read(l.prim), alt: read(l.alt), add: read(l.add) }]));
const rows = buildRecords(files, { uk: parseUkXml(readFileSync(ukPath, 'utf8')).entries, eu: parseEuXml(readFileSync(euPath, 'utf8')).entries });
const src = (l) => (l === 'SDN' || l === 'CONS' ? 'OFAC' : l);
// An entry's primary name, normalised and with words sorted; a pair is linked only by primary names.
const key = (n) => normalize(n).split(' ').filter(Boolean).sort().join(' ');
const people = rows.filter((r) => r.kind === 'individual').map((r) => ({ r, src: src(r.list), years: listFacts(r).years, keys: new Set([key(r.name)]) }));
const by = {};
for (const p of people) for (const k of p.keys) { const m = (by[p.src] ||= new Map()); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(p); }
const pairs = [['OFAC', 'UK'], ['UK', 'OFAC'], ['OFAC', 'EU'], ['EU', 'OFAC'], ['UK', 'EU'], ['EU', 'UK']];
const out = {};
const examples = [];
for (const [a, b] of pairs) {
  let linked = 0, both = 0, cleared = 0, exact = 0, single = 0;
  for (const p of people.filter((x) => x.src === a)) {
    // Linked only when exactly one entry on the other list shares the primary name, and no other entry on list a has it.
    const k = key(p.r.name);
    const other = [...(by[b]?.get(k) || [])];
    if (other.length !== 1 || (by[a].get(k)?.size || 0) !== 1) continue;
    linked++;
    const q = other[0];
    if (!p.years.length || !q.years.length) continue;
    both++;
    // The owner's year taken from list a (each year it gives); cleared when every one of them is cleared on list b.
    // The owner's year: list a must give one year only (one exact date of birth), as a vendor record does.
    if (p.years.length !== 1) continue;
    single++;
    if (birthYearClears(p.years[0], q.years)) { cleared++; examples.push(`${a} ${p.r.name} [${p.years.join(',')}] vs ${b} ${q.r.name} [${q.years.join(',')}]`); }
    if (p.years.some((y) => q.years.includes(y))) exact++;
  }
  out[`${a}-${b}`] = { linked, bothGiveYears: both, oneYearOnA: single, ruleWouldClear: cleared, shareAYear: exact };
}
console.log(JSON.stringify(out, null, 1));
console.log(examples.join('\n'));
