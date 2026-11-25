// Parse OFAC Sanctions List Service CSV exports (SDN and the consolidated non-SDN list).
// Files: SDN.CSV / CONS_PRIM.CSV (entries), ALT.CSV / CONS_ALT.CSV (aliases),
// ADD.CSV / CONS_ADD.CSV (addresses). No header row; "-0-" marks an empty field.
import { parseCsv } from './csv.js';

export const OFAC_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/';
export const LISTS = {
  SDN: { prim: 'SDN.CSV', alt: 'ALT.CSV', add: 'ADD.CSV' },
  CONS: { prim: 'CONS_PRIM.CSV', alt: 'CONS_ALT.CSV', add: 'CONS_ADD.CSV' },
};

const val = (s) => {
  const t = String(s ?? '').trim();
  return t === '-0-' || t === '' ? null : t;
};

// SDN_Type is "individual", "vessel", "aircraft", or empty for an entity.
const kind = (t) => (t === 'individual' ? 'individual' : t === 'vessel' ? 'vessel' : t === 'aircraft' ? 'aircraft' : 'entity');

export function parseEntries(text, list) {
  return parseCsv(text)
    .filter((r) => /^\d+$/.test(String(r[0]).trim()))
    .map((r) => ({
      id: `${list}:${String(r[0]).trim()}`,
      list,
      entNum: Number(String(r[0]).trim()),
      name: val(r[1]),
      kind: kind(val(r[2])),
      programs: (val(r[3]) || '').split(/\]\s*\[/).map((p) => p.replace(/[[\]]/g, '').trim()).filter(Boolean),
      title: val(r[4]),
      remarks: val(r[11]),
    }))
    .filter((e) => e.name);
}

export function parseAliases(text, list) {
  return parseCsv(text)
    .filter((r) => /^\d+$/.test(String(r[0]).trim()))
    .map((r) => ({ id: `${list}:${String(r[0]).trim()}`, altNum: Number(String(r[1]).trim()), type: val(r[2]) || 'aka', name: val(r[3]) }))
    .filter((a) => a.name);
}

export function parseAddresses(text, list) {
  return parseCsv(text)
    .filter((r) => /^\d+$/.test(String(r[0]).trim()))
    .map((r) => ({ id: `${list}:${String(r[0]).trim()}`, address: val(r[2]), city: val(r[3]), country: val(r[4]) }));
}
