// Name matching for sanctions screening. Pure functions, shared by the Forge backend and the
// offline accuracy test. A name is normalized, split into tokens without legal-form suffixes and
// particles, and compared token by token with Jaro-Winkler, weighted by how rare each token is
// on the sanctions lists (so "TRADING" or "MOHAMMAD" counts for less than "MELLAT").

const SUFFIXES = new Set([
  'LLC', 'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'GMBH', 'MBH', 'AG', 'SA', 'SRL',
  'BV', 'NV', 'PLC', 'LLP', 'LP', 'JSC', 'OJSC', 'PJSC', 'CJSC', 'OAO', 'ZAO', 'OOO', 'TOO', 'AO', 'PAO', 'FZE', 'FZCO',
  'FZC', 'FZ', 'FZLLC', 'DMCC', 'PTE', 'PVT', 'PRIVATE', 'SDN', 'BHD', 'KG', 'SPA', 'SAS', 'SARL', 'AS', 'AB', 'OY', 'KFT',
  'ZRT', 'DOO', 'LTDA', 'CIA', 'SL', 'SAC', 'SRO', 'EIRL', 'SAPI', 'CV', 'DE', 'RL', 'TIC', 'AS', 'AŞ', 'ŞTI', 'STI', 'SANAYI',
  'UAB', 'SIA', 'APS', 'OYJ', 'EOOD', 'OOD',
]);
// Long legal-form words, also recognised with a typo ("COPORATION", "COMPNAY").
const LONG_SUFFIXES = ['LIMITED', 'COMPANY', 'CORPORATION', 'INCORPORATED', 'PRIVATE'];
const PARTICLES = new Set(['THE', 'OF', 'AND', 'FOR', 'AL', 'EL', 'UL', 'DA', 'DI', 'DO', 'DOS', 'DAS', 'DU', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'Y', 'E', 'ET']);

export function normalize(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/['’`]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// True when a and b are at most one edit apart (insert, delete, substitute, or swap two neighbours).
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return true;
  const rest = (x, y) => a.slice(x) === b.slice(y);
  return rest(i + 1, i + 1) || rest(i + 1, i) || rest(i, i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(i + 2, i + 2));
}

const isSuffix = (t) => SUFFIXES.has(t) || (t.length >= 6 && LONG_SUFFIXES.some((x) => oneEdit(t, x)));

// Words of a name with runs of single letters joined ("L L C" -> "LLC").
function words(name) {
  const raw = normalize(name).split(' ').filter(Boolean);
  const joined = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].length === 1) {
      let j = i;
      let s = '';
      while (j < raw.length && raw[j].length === 1) { s += raw[j]; j += 1; }
      if (s.length > 1) { joined.push(s); i = j - 1; continue; }
    }
    joined.push(raw[i]);
  }
  return joined;
}

// Tokens of a name: legal-form suffixes and particles dropped.
export function tokenize(name) {
  const w = words(name);
  const kept = w.filter((t) => !isSuffix(t) && !PARTICLES.has(t));
  return kept.length ? kept : w.filter((t) => !PARTICLES.has(t));
}

// The name as one string without suffixes but with particles, for spacing and hyphen
// differences ("ALNAJIM" vs "AL-NAJIM", "ABD ALLAH" vs "ABDULLAH").
export function compact(name) {
  const w = words(name);
  const kept = w.filter((t) => !isSuffix(t));
  return (kept.length ? kept : w).join('');
}

// Consonant skeleton, so MOHAMMAD / MUHAMMAD / MOHAMED and YUSUF / YOUSEF share a key.
export function phoneticKey(token) {
  const t = token.replace(/KH/g, 'H').replace(/X/g, 'KS').replace(/PH/g, 'F').replace(/CK/g, 'K').replace(/Q/g, 'K').replace(/Z/g, 'S').replace(/W/g, 'V');
  const rest = t.slice(1).replace(/[AEIOUYH]/g, '').replace(/(.)\1+/g, '$1');
  return (t[0] + rest).slice(0, 5);
}

export function blockingKeys(token) {
  if (/^\d+$/.test(token)) return [`n:${token}`];
  const keys = [`p:${token.slice(0, 4)}`, `k:${phoneticKey(token)}`];
  if (token.length >= 6) keys.push(`s:${token.slice(-4)}`); // catches a typo near the start
  return keys;
}

export function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false);
  const mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j += 1) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = true; mb[j] = true; m += 1; break; }
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i += 1) {
    if (!ma[i]) continue;
    while (!mb[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && a[p] === b[p]) p += 1;
  return jaro + p * 0.1 * (1 - jaro);
}

// Levenshtein distance, or k + 1 once it is known to exceed k (only a band of width 2k is computed).
export function editDistance(a, b, k) {
  if (Math.abs(a.length - b.length) > k) return k + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(k + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = Math.max(1, i - k); j <= Math.min(b.length, i + k); j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > k) return k + 1;
    prev = cur;
  }
  return Math.min(prev[b.length], k + 1);
}

function tokenSim(q, c) {
  if (q === c) return 1;
  if (q.length === 1 || c.length === 1) return q[0] === c[0] ? 0.6 : 0; // an initial counts for part of a word
  if (/^\d+$/.test(q) || /^\d+$/.test(c)) return 0; // numbers must match exactly
  if (Math.min(q.length, c.length) <= 3) return q === c ? 1 : 0;
  // Jaro-Winkler rewards a shared prefix; "MARSHEND" is not "MARS".
  if (Math.abs(q.length - c.length) > Math.max(2, 0.25 * Math.max(q.length, c.length))) return 0;
  let sim = jaroWinkler(q, c);
  const key = phoneticKey(q);
  const sameSound = key.length >= 3 && key === phoneticKey(c);
  if (sameSound && sim >= 0.75) sim = Math.max(sim, 0.9);
  // A shared beginning alone ("XIAOQUAN" and "XIAOYAN") is not enough: the words must differ by one
  // letter, share their consonants, or be nearly equal.
  if (!sameSound && sim < 0.95 && editDistance(q, c, 1) > 1) return 0;
  // Unrelated words of similar letters still score about 0.8 with Jaro-Winkler; count them as no match.
  return sim >= 0.88 ? sim : 0;
}

// Weighted coverage of `from` tokens by their best counterpart in `to`.
function coverage(from, to, weight) {
  let num = 0;
  let den = 0;
  for (const f of from) {
    const w = weight(f);
    let best = 0;
    for (const t of to) best = Math.max(best, tokenSim(f, t));
    num += w * best;
    den += w;
  }
  return den ? num / den : 0;
}

// A listed person written "LAST, First Middle": the surname tokens and the given-name tokens.
export function personParts(name) {
  const i = String(name ?? '').indexOf(',');
  if (i < 0) return null;
  const surname = tokenize(name.slice(0, i));
  const given = tokenize(name.slice(i + 1));
  return surname.length && given.length ? { surname, given } : null;
}

// Score in [0, 1]. The query side counts more: a vendor name often leaves out a middle name or a
// trailing word that the list entry has. For a listed person, an owner written with the surname
// and one given name ("Viktor Bout" for "BOUT, Viktor Anatolijevitch") is not marked down for the
// other given names, patronymics or titles the list has, as long as the given name is spelled as
// listed or transliterated (Yusuf / Yousef), and the surname is spelled as listed, or differs by one
// letter when the given name is exact. Such a match scores at most 0.97, so that only a name
// matching every listed word scores 1.00.
export function nameScore(qTokens, cTokens, weight = () => 1, qCompact = qTokens.join(''), cCompact = cTokens.join(''), person = null) {
  if (!qTokens.length || !cTokens.length) return 0;
  const sq = coverage(qTokens, cTokens, weight);
  let sc = coverage(cTokens, qTokens, weight);
  let partial = false;
  // 0.7 * sq + 0.3 can only reach a threshold of 0.88 when sq is at least 0.83.
  if (person && person.given.length > 1 && sq >= 0.8) {
    const best = (t) => Math.max(...qTokens.map((x) => tokenSim(t, x)));
    const given = person.given.reduce((a, t) => (best(t) > best(a) ? t : a), person.given[0]);
    const givenSpelled = qTokens.some((x) => x === given || (given.length >= 3 && phoneticKey(x) === phoneticKey(given)));
    const surnameExact = person.surname.every((t) => best(t) === 1);
    const surnameNear = person.surname.every((t) => qTokens.some((x) => x === t || oneEdit(x, t)));
    if (givenSpelled && (surnameExact || (best(given) === 1 && surnameNear))) {
      const part = coverage([...person.surname, given], qTokens, weight);
      if (part > sc) { sc = part; partial = true; }
    }
  }
  const token = partial ? Math.min(0.97, 0.7 * sq + 0.3 * sc) : 0.7 * sq + 0.3 * sc;
  // Spacing and hyphen differences: the compact names may differ by one edit in twenty letters.
  const len = Math.max(qCompact.length, cCompact.length);
  const k = Math.floor(len / 20);
  const d = editDistance(qCompact, cCompact, k);
  const lev = d <= k ? 1 - d / len : 0;
  // Short names: Jaro-Winkler, only when nearly equal.
  const jw = Math.abs(qCompact.length - cCompact.length) <= 2 ? jaroWinkler(qCompact, cCompact) : 0;
  return Math.max(token, lev, jw >= 0.96 ? jw * 0.97 : 0);
}

// In-memory index over list names (primary names and aliases). The Forge backend keeps the same
// keys in SQL; this one is used by tests and the offline accuracy run.
export function buildIndex(entries, aliases = []) {
  const names = [];
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) names.push({ entryId: e.id, name: e.name, primary: true });
  // Weak aliases are kept for the reviewer but not searched. OFAC does not expect screening on weak
  // AKAs (FAQ 124) and leaves them out of ALT.CSV; the UK list marks the UN's low quality aliases.
  for (const a of aliases) if (byEntry.has(a.id) && a.type !== 'weak aka') names.push({ entryId: a.id, name: a.name, primary: false, aliasType: a.type });
  for (const n of names) if (byEntry.get(n.entryId).kind === 'individual') n.person = personParts(n.name);
  const postings = new Map();
  const df = new Map();
  names.forEach((n, i) => {
    n.tokens = tokenize(n.name);
    n.compact = compact(n.name);
    for (const t of new Set(n.tokens)) df.set(t, (df.get(t) || 0) + 1);
    for (const t of n.tokens) for (const k of blockingKeys(t)) {
      if (!postings.has(k)) postings.set(k, new Set());
      postings.get(k).add(i);
    }
  });
  return { names, postings, df, N: names.length, byEntry };
}

export function idfWeight(df, N) {
  const max = Math.log(N + 1);
  // A word never seen on the lists (often a typo of a common word) gets a middle weight.
  return (t) => (df.has(t) ? Math.max(0.15, Math.log((N + 1) / (1 + df.get(t))) / max) : 0.5);
}

// Screen one name. Candidates come from the blocking keys of the query's rarest tokens.
export function screen(index, query, { threshold = 0.88, limit = 10, maxCandidates = 4000 } = {}) {
  const q = tokenize(query);
  // A name with no word of two letters or more (a name in another script leaves single letters) cannot be screened.
  if (!q.some((t) => t.length > 1)) return [];
  const weight = idfWeight(index.df, index.N);
  const qc = compact(query);
  const rare = [...new Set(q)].sort((a, b) => weight(b) - weight(a)).slice(0, 3);
  // Most selective keys first, so a common word cannot crowd out the candidates of a rare one.
  const lists = rare.flatMap((t) => blockingKeys(t)).map((k) => index.postings.get(k)).filter(Boolean).sort((a, b) => a.size - b.size);
  const cand = new Set();
  for (const list of lists) {
    if (cand.size >= maxCandidates) break;
    for (const i of list) cand.add(i);
  }
  const best = new Map();
  for (const i of cand) {
    const n = index.names[i];
    const s = nameScore(q, n.tokens, weight, qc, n.compact, n.person);
    if (s < threshold) continue;
    const prev = best.get(n.entryId);
    if (!prev || s > prev.score) best.set(n.entryId, { entryId: n.entryId, matchedName: n.name, primary: n.primary, score: Math.round(s * 1000) / 1000 });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
