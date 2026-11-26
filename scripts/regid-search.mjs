// Registration-number search: recall on list numbers, and hits on real company numbers from GLEIF.
// usage: node scripts/regid-search.mjs <ofacDir> <uk.xml> <eu.xml> <gleif.json>...
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const APP = new URL('../src/', import.meta.url).href;
const { LISTS } = await import(APP + 'core/ofac.js');
const { parseUkXml } = await import(APP + 'core/uk.js');
const { parseEuXml } = await import(APP + 'core/eu.js');
const { buildRecords } = await import(APP + 'core/records.js');
const { buildIndex } = await import(APP + 'core/match.js');
const { companyIds, normId } = await import(APP + 'core/evidence.js');
const { countryCodeOf } = await import(APP + 'core/countries.js');
const { registrationHits, screenNames } = await import(APP + 'backend/screening.js');
const { MIN_ID } = await import(APP + 'backend/screen-index.js');
const [ofacDir, ukPath, euPath, ...gleifFiles] = process.argv.slice(2);
const read = (f) => readFileSync(join(ofacDir, f), 'latin1');
const files = Object.fromEntries(Object.entries(LISTS).map(([list, l]) => [list, { prim: read(l.prim), alt: read(l.alt), add: read(l.add) }]));
const rows = buildRecords(files, { uk: parseUkXml(readFileSync(ukPath, 'utf8')).entries, eu: parseEuXml(readFileSync(euPath, 'utf8')).entries });
// Same steps as loadIndex() in backend/screen-index.js.
const entries = rows.map((r) => ({ id: r.entry_id, list: r.list, entNum: r.ent_num, name: r.name, kind: r.kind, programs: r.programs, countries: r.countries, hash: r.hash }));
const aliases = rows.flatMap((r) => JSON.parse(r.aliases || '[]').map((a) => ({ id: r.entry_id, name: a.n, type: a.t })));
const ids = new Map();
for (const r of rows) {
  if (r.kind === 'individual' || !r.remarks) continue;
  for (const x of companyIds(r)) {
    const key = normId(x.value);
    if (key.length < MIN_ID) continue;
    if (!ids.has(key)) ids.set(key, []);
    if (!ids.get(key).some((y) => y.entryId === r.entry_id)) ids.get(key).push({ entryId: r.entry_id, label: x.label, value: x.value, country: x.country });
  }
}
const index = buildIndex(entries, aliases);
const cache = { index, ids };
const byId = new Map(rows.map((r) => [r.entry_id, r]));

// 1. Recall: each number on a list entry, searched with the country written next to it (or the entry's first country).
let pairs = 0, foundWithCountry = 0, foundNoCountry = 0, noCode = 0, short = 0;
const perList = {};
for (const r of rows) {
  if (r.kind === 'individual' || !r.remarks || /\b(IMO|MMSI|Vessel|Aircraft)\b/i.test(r.remarks)) continue;
  for (const x of companyIds(r)) {
    if (normId(x.value).length < MIN_ID) { short++; continue; }
    pairs++;
    const p = perList[r.list] ||= { pairs: 0, found: 0 };
    p.pairs++;
    const place = x.country || (r.countries || '').split('; ')[0];
    const code = place ? countryCodeOf(place) : null;
    if (place && !code) noCode++;
    if (registrationHits(cache, new Map(), { name: 'X', registrationNumber: x.value, country: code }).has(r.entry_id)) { foundWithCountry++; p.found++; }
    if (registrationHits(cache, new Map(), { name: 'X', registrationNumber: x.value, country: null }).has(r.entry_id)) foundNoCountry++;
  }
}
console.log(JSON.stringify({ numbers: pairs, shorterThanMin: short, foundWithCountry, foundNoCountry, placeWithoutCode: noCode, perList }));
const multi = [...ids.values()].filter((v) => v.length > 1);
console.log('keys', ids.size, 'keys on more than one entry', multi.length, 'of which all same name family?', multi.slice(0, 5).map((v) => v.map((x) => `${byId.get(x.entryId).list}:${byId.get(x.entryId).name}`).join(' / ')));

// 2. Real companies (GLEIF) searched by their registration number in their own country.
for (const f of gleifFiles) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const withReg = d.rows.filter((x) => x.reg);
  let hitCos = 0, nameAlso = 0;
  const out = [];
  for (const co of withReg) {
    const found = registrationHits(cache, new Map(), { name: co.name, registrationNumber: co.reg, country: co.country });
    if (!found.size) continue;
    hitCos++;
    const byName = screenNames(index, [co.name, ...(co.other || [])], 0.92);
    const both = [...found.keys()].some((id) => byName.has(id));
    if (both) nameAlso++;
    out.push(`${co.country} ${co.reg} "${co.name}"${co.other?.length ? ` [${co.other.slice(0, 2).join(' | ')}]` : ''} -> ${[...found.entries()].map(([id, h]) => `${byId.get(id).list}:${h.matchedName} (${h.matchedOn})`).join('; ')}${both ? ' [name also]' : ''}`);
  }
  console.log(`\n${f.split('/').pop()}: companies ${d.rows.length}, with number ${withReg.length}, number hits ${hitCos}, also found by name ${nameAlso}`);
  for (const l of out) console.log('  ' + l);
}
