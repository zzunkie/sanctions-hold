// Parse the EU consolidated list of persons, groups and entities subject to EU financial sanctions
// (the Financial Sanctions Files of the European Commission, XML 1.1) into list entries in the same
// shape as the OFAC and UK ones. Every entry on this list is under an asset freeze.
// Source: https://webgate.ec.europa.eu/fsd/fsf (the token in the URL is the public one the site gives).

import { normalize } from './match.js';
import { countryNameOf } from './countries.js';

export const EU_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
// The public RSS feed names each file with its address, publication time and SHA-1 checksum.
export const EU_RSS = 'https://webgate.ec.europa.eu/fsd/fsf/public/rss';

// The XML 1.1 item of the feed: { url, published (yyyy-mm-dd), checksum }, or null.
export function parseEuRss(text) {
  for (const m of String(text || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const url = /<enclosure url="([^"]+)"/.exec(m[1])?.[1]?.replace(/&amp;/g, '&');
    if (!url || !url.includes('xmlFullSanctionsList_1_1')) continue;
    const date = /<pubDate>([^<]+)<\/pubDate>/.exec(m[1])?.[1];
    return {
      url,
      published: date ? new Date(date).toISOString().slice(0, 10) : null,
      checksum: /checksum=([0-9A-Fa-f]+)/.exec(m[1])?.[1] || date || null,
    };
  }
  return null;
}

// The programme codes of the file, by the name of the sanctions regime.
export const EU_PROGRAMMES = {
  UKR: 'Ukraine territorial integrity', RUS: 'Russia', RUSDA: 'Russia destabilising activities', BLR: 'Belarus',
  IRN: 'Iran', SYR: 'Syria', PRK: 'North Korea', TAQA: 'ISIL (Da\'esh) and Al-Qaida', EUAQ: 'ISIL (Da\'esh) and Al-Qaida (EU)',
  TERR: 'Terrorism', HAM: 'Hamas and Palestinian Islamic Jihad', HR: 'Global human rights', CYB: 'Cyber-attacks',
  CHEM: 'Chemical weapons', AFG: 'Afghanistan', MMR: 'Myanmar', COD: 'DR Congo', IRQ: 'Iraq', VEN: 'Venezuela',
  LBY: 'Libya', MDA: 'Moldova', TUN: 'Tunisia', SDNZ: 'Sudan', SDN: 'Sudan (UN)', SSD: 'South Sudan', SOM: 'Somalia',
  NIC: 'Nicaragua', CAF: 'Central African Republic', HTI: 'Haiti', YEM: 'Yemen', GTM: 'Guatemala', GIN: 'Guinea',
  MLI: 'Mali', UNLI: 'UN listing',
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(String(s ?? '')).replace(/\s+/g, ' ').trim();

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z0-9]+)="([^"]*)"/g)].map((m) => [m[1], clean(m[2])]));
// Elements of one kind directly in the entry: their attributes and their own <remark>.
const elements = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag} ([^>]*?)(/>|>([\\s\\S]*?)</${tag}>)`, 'g'))]
  .map((m) => ({ ...attrs(m[1]), remark: /<remark>([\s\S]*?)<\/remark>/.exec(m[3] || '')?.[1] }));
const country = (code, description) => (code && code !== '00' ? countryNameOf(code) || description : null);
// Mostly Latin letters: a Cyrillic name with a stray Latin "Ë" or "e" in it is left out.
const latin = (s) => {
  const letters = s.match(/\p{L}/gu) || [];
  const lat = s.match(/\p{Script=Latin}/gu) || [];
  return lat.length >= 2 && lat.length * 2 >= letters.length;
};
// Written in Latin letters only (no Cyrillic, Greek or other script mixed in).
const allLatin = (s) => !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(s);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

// A person's name as "SURNAME, Given Middle", like the OFAC lists, when the file splits it.
// Without the split, a whole name whose last words are in capitals ("Olga Vladimirovna BALANDINA")
// gives the surname the same way.
function nameOf(a, person) {
  const given = [a.firstName, a.middleName].filter(Boolean).join(' ');
  if (person && a.lastName && given) return `${a.lastName}, ${given}`;
  const whole = a.wholeName || [given, a.lastName].filter(Boolean).join(' ');
  if (!person || whole.includes(',')) return whole;
  const words = whole.split(' ');
  const caps = (w) => /\p{Lu}{2,}/u.test(w) && w === w.toUpperCase();
  let i = words.length;
  while (i > 0 && caps(words[i - 1])) i -= 1;
  return i > 0 && i < words.length ? `${words.slice(i).join(' ')}, ${words.slice(0, i).join(' ')}` : whole;
}

export function parseEuXml(text) {
  const generated = /generationDate="([^"]+)"/.exec(text.slice(0, 2000))?.[1] || null;
  const entries = [];
  for (const m of text.matchAll(/<sanctionEntity ([^>]*)>([\s\S]*?)<\/sanctionEntity>/g)) {
    const head = attrs(m[1]);
    const d = m[2];
    const type = /<subjectType code="([a-z]+)"/.exec(d)?.[1];
    const kind = type === 'person' ? 'individual' : type === 'enterprise' ? 'entity' : null;
    if (!kind || !head.logicalId) continue;
    const regulation = elements(d, 'regulation')[0] || {};
    // Latin-script names only: the matcher compares Latin letters, and the file repeats each name
    // in the spelling of several EU languages, which often comes out the same without accents.
    const all = elements(d, 'nameAlias').map((a) => ({ ...a, name: nameOf(a, kind === 'individual') }));
    const seen = new Set();
    const names = all.filter((a) => a.name && latin(a.name))
      .filter((a) => { const k = normalize(a.name); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!names.length) continue;
    const plain = names.filter((a) => allLatin(a.name));
    const primary = plain.find((a) => a.nameLanguage === 'EN') || plain.find((a) => !a.nameLanguage) || plain[0] || names[0];
    const aliases = names.filter((a) => a !== primary).map((a) => ({ t: 'aka', n: a.name }));
    const addresses = elements(d, 'address').map((a) => ({
      a: [a.street, a.poBox, a.zipCode, a.region, a.place].filter(Boolean).join(', ') || null,
      c: a.city || null,
      k: country(a.countryIso2Code, a.countryDescription),
    })).filter((a) => a.a || a.c || a.k);
    const facts = head.euReferenceNumber ? [`EU reference number ${head.euReferenceNumber}`] : [];
    const dobs = uniq(elements(d, 'birthdate').map((b) => (b.birthdate || b.year ? `${b.circa === 'true' ? 'circa ' : ''}${b.birthdate || b.year}` : null)));
    if (dobs.length) facts.push(`DOB ${dobs.join(', ')}`);
    const nat = uniq(elements(d, 'citizenship').map((c) => country(c.countryIso2Code, c.countryDescription)));
    if (nat.length) facts.push(`nationality ${nat.join(', ')}`);
    const ids = elements(d, 'identification').filter((x) => x.number).map((x) => `${x.identificationTypeDescription || x.identificationTypeCode} ${x.number}${country(x.countryIso2Code) ? ` (${country(x.countryIso2Code)})` : ''}`);
    if (ids.length) facts.push(uniq(ids).slice(0, 10).join(', '));
    // The entry's own remarks, without those of its names, addresses and documents.
    const own = d.replace(/<(nameAlias|address|identification|birthdate|citizenship|regulation) [^>]*?(\/>|>[\s\S]*?<\/\1>)/g, '');
    const remarks = uniq([...own.matchAll(/<remark>([\s\S]*?)<\/remark>/g)].map((r) => clean(r[1])));
    // Remarks on a name ("Founder: ...") or an address ("Principal place of business: ...") too.
    const more = uniq([...all, ...elements(d, 'address')].map((x) => (x.remark ? clean(x.remark) : null)));
    facts.push(...uniq([...remarks, ...more]));
    const functions = uniq(all.map((a) => a.function));
    entries.push({
      id: `EU:${head.logicalId}`,
      list: 'EU',
      euReference: head.euReferenceNumber || null,
      entNum: Number(head.logicalId) || 0,
      name: primary.name,
      kind,
      programs: [EU_PROGRAMMES[regulation.programme] || regulation.programme].filter(Boolean),
      title: functions.join('; ') || null,
      remarks: facts.join('; ') || null,
      aliases,
      addresses,
      designated: head.designationDate || null,
      regulation: regulation.numberTitle || null,
    });
  }
  return { generated, entries };
}
