// Screens the sample vendors against downloaded OFAC exports, to check which ones match.
// usage: [UK=UK-Sanctions-List.xml] [EU=eu-fsf-1_1.xml] node scripts/sample-check.mjs <dir with OFAC CSV exports> [threshold]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntries, parseAliases } from '../src/core/ofac.js';
import { parseUkXml } from '../src/core/uk.js';
import { parseEuXml } from '../src/core/eu.js';
import { buildIndex, screen } from '../src/core/match.js';
import { ordinaryVendors, demoVendors } from '../src/core/sample.js';
import { ownerNames } from '../src/core/owners.js';

const [dir, th] = process.argv.slice(2);
const threshold = Number(th || 0.92);
const read = (f) => readFileSync(join(dir, f), 'latin1');
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
const index = buildIndex(entries, aliases);
for (const v of [...ordinaryVendors(), ...demoVendors()]) {
  for (const name of [v.name, ...ownerNames(v.owners)]) {
    const hits = screen(index, name, { threshold, limit: 3 });
    if (hits.length) console.log(`${v.key}\t${name}\t${hits.map((h) => `${h.matchedName || h.name} ${h.score.toFixed(3)}`).join(' | ')}`);
  }
}
