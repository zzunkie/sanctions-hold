// Offline accuracy run for the matcher.
// usage: [UK=UK-Sanctions-List.xml] [EU=eu-fsf-1_1.xml] node scripts/accuracy.mjs <dir with OFAC CSV exports> [negatives: src/data/negatives.json, or a dir of GLEIF lei-records JSON pages] [threshold]
// env: SAMPLE (list entries to vary, default 1500), SEED (default 42), JSON=1 for machine-readable output,
//      UK (UK Sanctions List XML), EU (EU consolidated financial sanctions list XML 1.1), PEOPLE (person names not on the lists).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntries, parseAliases } from '../src/core/ofac.js';
import { parseUkXml } from '../src/core/uk.js';
import { parseEuXml } from '../src/core/eu.js';
import { buildIndex } from '../src/core/match.js';
import { evaluate } from '../src/core/accuracy.js';

const [ofacDir, negDir, thArg] = process.argv.slice(2);
const threshold = Number(thArg || 0.92);
const read = (f) => readFileSync(join(ofacDir, f), 'latin1');
const entries = [...parseEntries(read('SDN.CSV'), 'SDN'), ...parseEntries(read('CONS_PRIM.CSV'), 'CONS')]
  .filter((e) => e.kind === 'entity' || e.kind === 'individual');
const aliases = [...parseAliases(read('ALT.CSV'), 'SDN'), ...parseAliases(read('CONS_ALT.CSV'), 'CONS')];
// UK=<path to UK-Sanctions-List.xml> adds the UK Sanctions List, as the app does.
if (process.env.UK) {
  const uk = parseUkXml(readFileSync(process.env.UK, 'utf8')).entries;
  entries.push(...uk);
  aliases.push(...uk.flatMap((e) => e.aliases.map((a) => ({ id: e.id, name: a.n, type: a.t }))));
}
// EU=<path to the EU list XML> adds the EU consolidated list, as the app does.
if (process.env.EU) {
  const eu = parseEuXml(readFileSync(process.env.EU, 'utf8')).entries;
  entries.push(...eu);
  aliases.push(...eu.flatMap((e) => e.aliases.map((a) => ({ id: e.id, name: a.n, type: a.t }))));
}
let t0 = Date.now();
const index = buildIndex(entries, aliases);
const buildMs = Date.now() - t0;
const aliasesById = new Map();
for (const a of aliases) { if (!aliasesById.has(a.id)) aliasesById.set(a.id, []); aliasesById.get(a.id).push(a); }

const negPath = negDir || new URL('../src/data/negatives.json', import.meta.url).pathname;
const negFiles = statSync(negPath).isDirectory() ? readdirSync(negPath).filter((x) => x.endsWith('.json')).map((f) => join(negPath, f)) : [negPath];
const negatives = [];
for (const f of negFiles) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const list = Array.isArray(d) ? d : d.names || (d.data || []).map((r) => ({ name: r.attributes.entity.legalName.name, country: r.attributes.entity.legalAddress.country }));
  negatives.push(...list);
}

// PEOPLE=<people json> adds real person names not on the lists as a second negative sample.
const peopleFile = process.env.PEOPLE ? JSON.parse(readFileSync(process.env.PEOPLE, 'utf8')) : null;
const people = peopleFile && (Array.isArray(peopleFile) ? peopleFile : peopleFile.names);
const r = evaluate(index, entries, aliasesById, negatives, { threshold, sample: Number(process.env.SAMPLE || 1500), seed: Number(process.env.SEED || 42), people });
if (process.env.JSON) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`threshold ${threshold}; list names indexed ${index.N} (entries ${entries.length}, aliases ${aliases.length}); index build ${buildMs} ms`);
for (const [k, s] of Object.entries(r.positives)) console.log(`recall ${k.padEnd(16)} ${pct(s.found, s.n)} (${s.found}/${s.n})`);
console.log(`recall all              ${pct(r.total.found, r.total.n)} (${r.total.found}/${r.total.n})`);
console.log(`false positives         ${pct(r.negatives.falsePositives, r.negatives.n)} (${r.negatives.falsePositives}/${r.negatives.n} real company names; ${r.negatives.sameName} more share a list name: ${r.sameSamples.join(' | ')})`);
if (r.people) console.log(`false positives people  ${pct(r.people.falsePositives, r.people.n)} (${r.people.falsePositives}/${r.people.n} real person names; ${r.people.sameName} more share a list name)`);
console.log(`avg screen time         ${r.avgMs.toFixed(2)} ms over ${r.queries} queries`);
for (const [k, m] of Object.entries(r.misses)) { console.log(`-- missed ${k}`); m.forEach((x) => console.log(`    ${x.query}  ->  ${x.expected}${x.top ? `  (top: ${x.top})` : ''}`)); }
console.log('-- false positive samples'); r.fpSamples.forEach((x) => console.log(`    ${x.name} [${x.country}] -> ${x.matched} ${x.score}`));
