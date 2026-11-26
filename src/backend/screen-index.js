// The name index lives in memory and is rebuilt from Forge SQL when the list version changes.
import { buildIndex } from '../core/match.js';
import { companyIds, normId } from '../core/evidence.js';
import { q } from './db.js';
import { listState } from './lists.js';

let cache = null;
// Shorter numbers are too common across registers to identify a company on their own.
export const MIN_ID = 6;
const PAGE = 3000;

export async function loadIndex() {
  const state = await listState();
  if (!state) return null;
  if (cache && cache.version === state.version) return cache;
  const rows = [];
  let last = '';
  for (;;) {
    const part = await q(`SELECT entry_id, list, ent_num, name, kind, programs, countries, aliases, hash, CASE WHEN kind <> 'individual' THEN remarks END AS remarks FROM list_entry
                          WHERE active = 1 AND entry_id > ? ORDER BY entry_id LIMIT ${PAGE}`, last);
    rows.push(...part);
    if (part.length < PAGE) break;
    last = part[part.length - 1].entry_id;
  }
  const entries = rows.map((r) => ({ id: r.entry_id, list: r.list, entNum: r.ent_num, name: r.name, kind: r.kind, programs: r.programs, countries: r.countries, hash: r.hash }));
  const aliases = rows.flatMap((r) => JSON.parse(r.aliases || '[]').map((a) => ({ id: r.entry_id, name: a.n, type: a.t })));
  // Registration, license and tax numbers of listed companies, so a vendor can be found by its number under any name.
  const ids = new Map();
  for (const r of rows) {
    if (!r.remarks) continue;
    for (const x of companyIds(r)) {
      const key = normId(x.value);
      if (key.length < MIN_ID) continue;
      if (!ids.has(key)) ids.set(key, []);
      if (!ids.get(key).some((y) => y.entryId === r.entry_id)) ids.get(key).push({ entryId: r.entry_id, label: x.label, value: x.value, country: x.country });
    }
  }
  cache = { version: state.version, state, index: buildIndex(entries, aliases), ids };
  return cache;
}
