// The year-of-birth rule on people listed by two sources. For each person listed under the same primary name
// on two of the OFAC, UK and EU lists, the single year of birth on the first entry is taken as an owner's,
// and the owner is screened against all three lists with the rule on, as the app screens a vendor's owner.
// Counts how often the rule clears the second list's entry and whether the owner still goes to review.
// usage: node scripts/yob-cross.mjs <dir with OFAC CSV exports> <UK-Sanctions-List.xml> <eu.xml>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const APP = new URL('../src/', import.meta.url).href;
const { LISTS, parseEntries, parseAliases } = await import(APP + 'core/ofac.js');
const { parseUkXml } = await import(APP + 'core/uk.js');
const { parseEuXml } = await import(APP + 'core/eu.js');
const { buildRecords } = await import(APP + 'core/records.js');
const { listFacts, birthYearClears } = await import(APP + 'core/evidence.js');
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
  let checks = 0, cleared = 0, sameDayMonth = 0, review = 0;
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
    // The owner screened as the app screens a vendor's owner: every possible match the rule does not clear stays open.
    const found = new Map(screen(index, p.r.name, { threshold: THRESHOLD, limit: 10 }).map((h) => [h.entryId, h]));
    for (const id of [...found.keys()]) if (id.startsWith('CONS:') && found.has(`SDN:${id.slice(5)}`)) found.delete(id);
    const open = [...found.keys()].filter((id) => !birthYearClears(born, facts.get(id)?.years || []));
    if (open.length) review++;
    if (birthYearClears(born, q.years)) {
      cleared++;
      const dm = dayMonths(facts.get(p.r.entry_id).born);
      if ([...dayMonths(facts.get(q.r.entry_id).born)].some((x) => dm.has(x))) sameDayMonth++;
      examples.push(`${a} ${p.r.name} [${p.years.join(',')}] vs ${b} ${q.r.name} [${q.years.join(',')}]: ${open.length ? 'review' : 'cleared'}`);
    }
  }
  out[`${a}-${b}`] = { checks, ownerWentToReview: review, secondEntryCleared: cleared, clearedWithSameDayAndMonth: sameDayMonth };
}
const total = Object.values(out).reduce((t, x) => ({ checks: t.checks + x.checks, review: t.review + x.ownerWentToReview, cleared: t.cleared + x.secondEntryCleared, sameDayMonth: t.sameDayMonth + x.clearedWithSameDayAndMonth }), { checks: 0, review: 0, cleared: 0, sameDayMonth: 0 });
console.log(JSON.stringify({ ...out, total }, null, 1));
console.log(examples.join('\n'));
