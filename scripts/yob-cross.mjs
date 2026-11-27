// The year-of-birth rule on people listed by two sources. For each person listed under the same primary name
// on two of the OFAC, UK and EU lists, the single year of birth on the first entry is taken as an owner's,
// and the owner is screened against all three lists with the rule on, as the app screens a vendor's owner.
// Counts the checks where the second entry's years are all more than a year from the owner's, and how many
// of those the rule clears; it keeps a match open while another matched entry under the same name gives the year.
// usage: node scripts/yob-cross.mjs <dir with OFAC CSV exports> <UK-Sanctions-List.xml> <eu.xml>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const APP = new URL('../src/', import.meta.url).href;
const { LISTS, parseEntries, parseAliases } = await import(APP + 'core/ofac.js');
const { parseUkXml } = await import(APP + 'core/uk.js');
const { parseEuXml } = await import(APP + 'core/eu.js');
const { buildRecords } = await import(APP + 'core/records.js');
const { listFacts, birthYearClears, clearedByBirthYear } = await import(APP + 'core/evidence.js');
const { normalize, buildIndex, screen } = await import(APP + 'core/match.js');
const [ofacDir, ukPath, euPath] = process.argv.slice(2);
const read = (f) => readFileSync(join(ofacDir, f), 'latin1');
const files = Object.fromEntries(Object.entries(LISTS).map(([list, l]) => [list, { prim: read(l.prim), alt: read(l.alt), add: read(l.add) }]));
const uk = parseUkXml(readFileSync(ukPath, 'utf8')).entries;
const eu = parseEuXml(readFileSync(euPath, 'utf8')).entries;
const rows = buildRecords(files, { uk, eu });
const facts = new Map(rows.map((r) => [r.entry_id, listFacts(r)]));

// The index the app screens with: OFAC SDN and Consolidated, UK and EU entries with their aliases.
const entries = [...parseEntries(read('SDN.CSV'), 'SDN'), ...parseEntries(read('CONS_PRIM.CSV'), 'CONS')].filter((e) => e.kind === 'entity' || e.kind === 'individual');
const aliases = [...parseAliases(read('ALT.CSV'), 'SDN'), ...parseAliases(read('CONS_ALT.CSV'), 'CONS')];
for (const l of [uk, eu]) {
  entries.push(...l);
  aliases.push(...l.flatMap((e) => e.aliases.map((a) => ({ id: e.id, name: a.n, type: a.t }))));
}
const index = buildIndex(entries, aliases);
const THRESHOLD = 0.92;

const src = (l) => (l === 'SDN' || l === 'CONS' ? 'OFAC' : l);
// An entry's primary name, normalised and with words sorted; a pair is linked only by primary names.
const key = (n) => normalize(n).split(' ').filter(Boolean).sort().join(' ');
// Day and month of each full date of birth ("8 Oct 1963" gives "8 Oct").
const dayMonths = (born) => new Set([...String(born || '').matchAll(/\b(\d{1,2} [A-Z][a-z]{2}) \d{4}\b/g)].map((m) => m[1]));
const people = rows.filter((r) => r.kind === 'individual').map((r) => ({ r, src: src(r.list), years: facts.get(r.entry_id).years }));
const by = {};
for (const p of people) {
  const m = (by[p.src] ||= new Map());
  const k = key(p.r.name);
  if (!m.has(k)) m.set(k, new Set());
  m.get(k).add(p);
}
const pairs = [['OFAC', 'UK'], ['UK', 'OFAC'], ['OFAC', 'EU'], ['EU', 'OFAC'], ['UK', 'EU'], ['EU', 'UK']];
const out = {};
const examples = [];
for (const [a, b] of pairs) {
  let checks = 0, yearsApart = 0, sameDayMonth = 0, cleared = 0, review = 0;
  for (const p of people.filter((x) => x.src === a)) {
    // Linked only when exactly one entry on the other list shares the primary name, and no other entry on list a has it.
    const k = key(p.r.name);
    const other = [...(by[b]?.get(k) || [])];
    if (other.length !== 1 || (by[a].get(k)?.size || 0) !== 1) continue;
    const q = other[0];
    // The owner's year: the first entry must give one year only (one exact date of birth), as a vendor record does.
    if (p.years.length !== 1 || !q.years.length) continue;
    checks++;
    const born = p.years[0];
    // The owner screened as the app screens a vendor's owner, with the rule applied over the owner's matches together.
    const found = new Map(screen(index, p.r.name, { threshold: THRESHOLD, limit: 10 }).map((h) => [h.entryId, h]));
    for (const id of [...found.keys()]) if (id.startsWith('CONS:') && found.has(`SDN:${id.slice(5)}`)) found.delete(id);
    const ruled = clearedByBirthYear(born, [...found.keys()].map((id) => ({ id, name: index.byEntry.get(id)?.name, years: facts.get(id)?.years || [] })));
    if ([...found.keys()].some((id) => !ruled.has(id))) review++;
    if (ruled.has(q.r.entry_id)) cleared++;
    if (birthYearClears(born, q.years)) {
      yearsApart++;
      const dm = dayMonths(facts.get(p.r.entry_id).born);
      if ([...dayMonths(facts.get(q.r.entry_id).born)].some((x) => dm.has(x))) sameDayMonth++;
      examples.push(`${a} ${p.r.name} [${p.years.join(',')}] vs ${b} ${q.r.name} [${q.years.join(',')}]: ${ruled.has(q.r.entry_id) ? 'cleared' : 'kept open'}`);
    }
  }
  out[`${a}-${b}`] = { checks, ownerWentToReview: review, yearsMoreThanAYearApart: yearsApart, withSameDayAndMonth: sameDayMonth, secondEntryClearedByRule: cleared };
}
const total = Object.values(out).reduce((t, x) => ({ checks: t.checks + x.checks, review: t.review + x.ownerWentToReview, yearsApart: t.yearsApart + x.yearsMoreThanAYearApart, sameDayMonth: t.sameDayMonth + x.withSameDayAndMonth, cleared: t.cleared + x.secondEntryClearedByRule }), { checks: 0, review: 0, yearsApart: 0, sameDayMonth: 0, cleared: 0 });
console.log(JSON.stringify({ ...out, total }, null, 1));
console.log(examples.join('\n'));
