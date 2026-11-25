// The name index lives in memory and is rebuilt from Forge SQL when the list version changes.
import { buildIndex } from '../core/match.js';
import { q } from './db.js';
import { listState } from './lists.js';

let cache = null;
const PAGE = 3000;

export async function loadIndex() {
  const state = await listState();
  if (!state) return null;
  if (cache && cache.version === state.version) return cache;
  const rows = [];
  let last = '';
  for (;;) {
    const part = await q(`SELECT entry_id, list, ent_num, name, kind, programs, countries, aliases, hash FROM list_entry
                          WHERE active = 1 AND entry_id > ? ORDER BY entry_id LIMIT ${PAGE}`, last);
    rows.push(...part);
    if (part.length < PAGE) break;
    last = part[part.length - 1].entry_id;
  }
  const entries = rows.map((r) => ({ id: r.entry_id, list: r.list, entNum: r.ent_num, name: r.name, kind: r.kind, programs: r.programs, countries: r.countries, hash: r.hash }));
  const aliases = rows.flatMap((r) => JSON.parse(r.aliases || '[]').map((a) => ({ id: r.entry_id, name: a.n, type: a.t })));
  cache = { version: state.version, state, index: buildIndex(entries, aliases) };
  return cache;
}
