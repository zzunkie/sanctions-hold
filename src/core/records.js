// Turn the OFAC CSV exports, the UK Sanctions List and the EU consolidated list into one record per
// list entry (entities and individuals), and work out what changed against the entries already stored.
import { parseEntries, parseAliases, parseAddresses } from './ofac.js';

// 64-bit FNV-1a as 16 hex characters; enough to notice that an entry changed.
export function hash16(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const group = (rows) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(r);
  }
  return m;
};

function record(e, al, ad) {
  const addresses = ad.slice(0, 20);
  const countries = [...new Set(addresses.map((a) => a.k).filter(Boolean))];
  const programs = e.programs.join('; ');
  return {
    entry_id: e.id,
    list: e.list,
    ent_num: e.entNum,
    name: e.name,
    kind: e.kind,
    programs,
    title: e.title,
    remarks: e.remarks,
    aliases: JSON.stringify(al),
    addresses: JSON.stringify(addresses),
    countries: countries.join('; '),
    hash: hash16([e.name, e.kind, programs, al.map((a) => a.n).sort().join('|'), countries.sort().join('|')].join('#')),
  };
}

// files: { SDN: {prim, alt, add}, CONS: {prim, alt, add} } as text; uk, eu: entries from parseUkXml, parseEuXml.
// holdBackFrom: leave out SDN entries with ent_num >= this number (demo replay of new designations).
export function buildRecords(files, { holdBackFrom = null, uk = [], eu = [] } = {}) {
  const records = [];
  for (const [list, f] of Object.entries(files)) {
    const aliases = group(parseAliases(f.alt, list));
    const addresses = group(parseAddresses(f.add, list));
    for (const e of parseEntries(f.prim, list)) {
      if (e.kind !== 'entity' && e.kind !== 'individual') continue;
      if (holdBackFrom && list === 'SDN' && e.entNum >= holdBackFrom) continue;
      const al = (aliases.get(e.id) || []).map((a) => ({ t: a.type, n: a.name }));
      const ad = (addresses.get(e.id) || []).map((a) => ({ a: a.address, c: a.city, k: a.country }));
      records.push(record(e, al, ad));
    }
  }
  for (const e of [...uk, ...eu]) records.push(record(e, e.aliases, e.addresses));
  return records;
}

// existing: [{entry_id, hash, active}] as stored. Returns what to write and what to report.
export function diffRecords(existing, records) {
  const old = new Map(existing.map((r) => [r.entry_id, r]));
  const seen = new Set();
  const added = [];
  const changed = [];
  for (const r of records) {
    seen.add(r.entry_id);
    const o = old.get(r.entry_id);
    if (!o || !Number(o.active)) added.push(r);
    else if (o.hash !== r.hash) changed.push(r);
  }
  const removed = existing.filter((r) => Number(r.active) && !seen.has(r.entry_id)).map((r) => r.entry_id);
  return { added, changed, removed };
}
