// List import: check whether OFAC, the UK or the EU has published a new version, download the OFAC
// CSV exports, the UK Sanctions List XML and the EU consolidated list XML, store one row per entry
// and record what was added, removed or changed.
import { fetch } from '@forge/api';
import { OFAC_BASE, LISTS } from '../core/ofac.js';
import { UK_URL, parseUkXml } from '../core/uk.js';
import { EU_URL, EU_RSS, parseEuRss, parseEuXml } from '../core/eu.js';
import { buildRecords, diffRecords, hash16 } from '../core/records.js';
import { q, insertMany, marks, getSetting, setSetting, logEvent, nowDt } from './db.js';

const FILES = Object.values(LISTS).flatMap((l) => [l.prim, l.alt, l.add]);
// Every export URL redirects to a storage path with the publication date and id, shared by all files.
const PUBLISHED_RE = /\/Published\/[^/]+\/(\d{4}-\d{2}-\d{2})\/([0-9a-f-]{8,})\//;

export const listState = () => getSetting('list', null);

// The list servers answer an occasional request with a 5xx; try twice more before giving up.
async function fetchRetry(url, options) {
  for (let i = 0; ; i += 1) {
    const res = await fetch(url, options).catch((e) => (i < 2 ? null : Promise.reject(e)));
    if (res && (res.status < 500 || i >= 2)) return res;
    await new Promise((r) => { setTimeout(r, 3000 * (i + 1)); });
  }
}

// The current publication without downloading the files: the redirect names the publication, and
// SDN.CSV (the only export that answers HEAD) gives the date the list was last updated, which is
// the date OFAC's own search page shows.
async function ofacPublication() {
  const [res, head] = await Promise.all([
    fetch(`${OFAC_BASE}SDN.CSV`, { redirect: 'manual' }),
    fetch(`${OFAC_BASE}SDN.CSV`, { method: 'HEAD' }).catch(() => null),
  ]);
  const where = (res.status >= 300 && res.status < 400 ? res.headers.get('location') : res.url) || '';
  const m = PUBLISHED_RE.exec(where);
  const modified = head?.ok ? head.headers.get('last-modified') : null;
  const updated = modified ? new Date(modified).toISOString().slice(0, 10) : m?.[1] || null;
  // Files can be replaced inside the same publication path, so the modification time is part of the id.
  if (m) return { id: hash16(`${m[2]}|${modified || ''}`), published: updated };
  if (!head?.ok) throw new Error(`OFAC SDN.CSV: HTTP ${head?.status || res.status}`);
  return { id: hash16(head.headers.get('digest') || modified || ''), published: updated };
}

// The UK list is one file that answers HEAD with an ETag and its modification time.
async function ukPublication() {
  const head = await fetch(UK_URL, { method: 'HEAD' });
  if (!head.ok) throw new Error(`UK Sanctions List: HTTP ${head.status}`);
  const modified = head.headers.get('last-modified');
  return { id: head.headers.get('etag') || modified || '', published: modified ? new Date(modified).toISOString().slice(0, 10) : null };
}

// The EU publishes a small RSS feed with the file's checksum; the file itself answers HEAD with its
// modification time and length when the feed cannot be read.
async function euPublication() {
  const rss = await fetch(EU_RSS).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const item = parseEuRss(rss);
  if (item) return { id: item.checksum, published: item.published, url: item.url };
  const head = await fetch(EU_URL, { method: 'HEAD' });
  if (!head.ok) throw new Error(`EU consolidated list: HTTP ${head.status}`);
  const modified = head.headers.get('last-modified');
  return { id: `${modified || ''}|${head.headers.get('content-length') || ''}`, published: modified ? new Date(modified).toISOString().slice(0, 10) : null, url: EU_URL };
}

export async function currentPublication() {
  const [ofac, uk, eu] = await Promise.all([ofacPublication(), ukPublication(), euPublication()]);
  return { id: hash16(`${ofac.id}|${uk.id}|${eu.id}`), published: ofac.published, ukPublished: uk.published, euPublished: eu.published, euUrl: eu.url };
}

async function downloadUk() {
  const res = await fetchRetry(UK_URL);
  if (!res.ok) throw new Error(`UK Sanctions List: HTTP ${res.status}`);
  const uk = parseUkXml(Buffer.from(await res.arrayBuffer()).toString('utf8'));
  // An empty parse would mark every UK entry as removed.
  if (!uk.entries.length) throw new Error('UK Sanctions List: no entries in the file');
  return uk;
}

// About 26 MB, sent gzip-compressed (about 3.4 MB).
async function downloadEu(url) {
  const res = await fetchRetry(url || EU_URL, { headers: { 'Accept-Encoding': 'gzip' } });
  if (!res.ok) throw new Error(`EU consolidated list: HTTP ${res.status}`);
  const eu = parseEuXml(Buffer.from(await res.arrayBuffer()).toString('utf8'));
  if (!eu.entries.length) throw new Error('EU consolidated list: no entries in the file');
  return eu;
}

async function download(file) {
  const res = await fetchRetry(`${OFAC_BASE}${file}`);
  if (!res.ok) throw new Error(`OFAC ${file}: HTTP ${res.status}`);
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  return { text, published: PUBLISHED_RE.exec(res.url || '')?.[1] || null, modified: res.headers.get('last-modified') };
}

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
const COLS = ['entry_id', 'list', 'ent_num', 'name', 'kind', 'programs', 'title', 'remarks', 'aliases', 'addresses', 'countries', 'hash', 'added_version', 'active', 'updated_at'];
const UPDATE = COLS.filter((c) => c !== 'entry_id' && c !== 'added_version').map((c) => `${c} = VALUES(${c})`).join(', ');
const row = (r, version, now) => [r.entry_id, r.list, r.ent_num, cut(r.name, 600), r.kind, cut(r.programs, 600), cut(r.title, 600), r.remarks, r.aliases, r.addresses, cut(r.countries, 600), r.hash, version, 1, now];

// holdBackFrom: demo only; leaves out the newest SDN designations so a later import adds them.
export async function importLists({ reason = 'update', holdBackFrom = null } = {}) {
  const pub = await currentPublication();
  const digest = pub.id;
  const got = {};
  const [uk, eu] = await Promise.all([downloadUk(), downloadEu(pub.euUrl), ...FILES.map(async (f) => { got[f] = await download(f); })]);
  const files = Object.fromEntries(Object.entries(LISTS).map(([list, l]) => [list, { prim: got[l.prim].text, alt: got[l.alt].text, add: got[l.add].text }]));
  const published = pub.published || got['SDN.CSV'].published;
  const records = buildRecords(files, { holdBackFrom, uk: uk.entries, eu: eu.entries });
  const ukCount = uk.entries.length;
  const euCount = eu.entries.length;
  const version = `${published || 'unknown'}+${pub.ukPublished || 'unknown'}+${pub.euPublished || 'unknown'}:${digest.slice(0, 8)}${holdBackFrom ? ':held' : ''}`;

  const existing = await q('SELECT entry_id, hash, active FROM list_entry');
  const initial = existing.length === 0;
  const { added, changed, removed } = diffRecords(existing, records);
  const now = nowDt();
  await insertMany('list_entry', COLS, added.map((r) => row(r, version, now)), { onDuplicate: `ON DUPLICATE KEY UPDATE ${UPDATE}, added_version = VALUES(added_version)` });
  await insertMany('list_entry', COLS, changed.map((r) => row(r, version, now)), { onDuplicate: `ON DUPLICATE KEY UPDATE ${UPDATE}` });
  for (let i = 0; i < removed.length; i += 500) {
    const part = removed.slice(i, i + 500);
    await q(`UPDATE list_entry SET active = 0, updated_at = ? WHERE entry_id IN (${marks(part.length)})`, now, ...part);
  }
  if (!initial) {
    const removedRows = [];
    for (let i = 0; i < removed.length; i += 500) {
      const part = removed.slice(i, i + 500);
      removedRows.push(...await q(`SELECT entry_id, name, programs FROM list_entry WHERE entry_id IN (${marks(part.length)})`, ...part));
    }
    const change = (type) => (r) => [crypto.randomUUID(), version, r.entry_id, type, cut(r.name, 600), cut(r.programs, 600), now];
    await insertMany('list_change', ['id', 'version_id', 'entry_id', 'change_type', 'name', 'programs', 'at'], [
      ...added.map(change('added')), ...changed.map(change('changed')), ...removedRows.map(change('removed')),
    ]);
  }
  const note = holdBackFrom ? `Sample start: SDN entries numbered ${holdBackFrom} and later come in the next update` : initial ? 'First import' : null;
  await q('INSERT INTO list_version (id, published, fetched_at, entries, added, removed, changed, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE fetched_at = VALUES(fetched_at)',
    version, published, now, records.length, initial ? 0 : added.length, removed.length, changed.length, note);
  const state = {
    version, published, ukPublished: pub.ukPublished, euPublished: pub.euPublished, digest, entries: records.length,
    ofacEntries: records.length - ukCount - euCount, ukEntries: ukCount, euEntries: euCount,
    fetchedAt: new Date().toISOString(), holdBackFrom: holdBackFrom || null, lists: [...Object.keys(LISTS), 'UK', 'EU'],
  };
  await setSetting('list', state);
  await logEvent({ type: 'list_updated', detail: { version, published, ukPublished: pub.ukPublished, euPublished: pub.euPublished, initial, heldBack: Boolean(holdBackFrom), entries: records.length, added: initial ? 0 : added.length, changed: changed.length, removed: removed.length, reason }, actor: 'app' });
  return { ...state, added: initial ? 0 : added.length, changed: changed.length, removed: removed.length, initial };
}

// Hourly: import only when OFAC, the UK or the EU published a new version.
export async function checkForUpdate() {
  const state = await listState();
  if (!state) return { changed: false, reason: 'not loaded' };
  const pub = await currentPublication();
  const digest = pub.id;
  await setSetting('listCheck', { at: new Date().toISOString(), digest, published: pub.published, ukPublished: pub.ukPublished, euPublished: pub.euPublished });
  if (digest === state.digest) return { changed: false };
  return { changed: true };
}
