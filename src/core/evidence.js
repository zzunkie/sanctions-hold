// What a list entry says about a listed person, and how it compares with what the vendor gave for
// an owner or director. OFAC remarks and the UK and EU details all carry "DOB ..." and "nationality ..."
// (OFAC also "citizen ..."); an entry can give several dates of birth.
import { COUNTRY_NAMES } from './sample.js';
import { countryNameOf } from './countries.js';
import { normalize } from './match.js';

export const countrySpellings = (c) => [COUNTRY_NAMES[String(c || '').toUpperCase()], countryNameOf(c)].filter(Boolean).map((x) => x.toLowerCase());

// OFAC writes "08 Oct 1963", the UK "24/06/1961" (or "--/--/1961"), the EU "1980-01-11"; all are shown as "8 Oct 1963".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (d, m, y) => [Number(d) ? String(Number(d)) : null, MONTHS[Number(m) - 1] || null, y].filter(Boolean).join(' ');
export const fmtDob = (s) => String(s)
  .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => dm(d, m, y))
  .replace(/(\d{2}|--)\/(\d{2}|--)\/(\d{4})/g, (_, d, m, y) => dm(d === '--' ? 0 : d, m === '--' ? 0 : m, y))
  .replace(/\b0(\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, '$1 $2');

// The years a date of birth allows: OFAC writes a range as "1955 to 1957" (every year in it) and an
// approximate year as "circa 1951" (taken as two years either side).
function yearsOfDob(d) {
  const ys = (String(d).match(/\b(?:18|19|20)\d{2}\b/g) || []).map(Number);
  const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  if (ys.length === 2 && /\bto\b/i.test(d) && ys[1] >= ys[0] && ys[1] - ys[0] <= 30) return span(ys[0], ys[1]);
  if (ys.length === 1 && /\b(circa|approx(imately)?|about)\b/i.test(d)) return span(ys[0] - 2, ys[0] + 2);
  return ys.map(String);
}

export function listFacts(entry) {
  const r = entry?.remarks || '';
  // Only at the start of a "; "-separated part, so that a name such as "DOBROV" or a sentence about
  // "citizens" in the statement of reasons is not read as a date of birth or a nationality.
  const dobs = [...r.matchAll(/(?:^|;)\s*(?:alt\.\s*)?DOB\b:?\s*([^;]+)/gi)].map((m) => fmtDob(m[1].trim()));
  const nats = [...new Set([...r.matchAll(/(?:^|;)\s*(?:alt\.\s*)?(?:nationality|citizen)\b:?\s*([^;]+)/gi)].map((m) => m[1].trim()))];
  const years = [...new Set(dobs.flatMap(yearsOfDob))];
  // OFAC remarks also give "POB ...", "Passport V45786901 (Iran)" and "National ID No. ... (Iran)".
  const pobs = [...r.matchAll(/(?:^|;)\s*(?:alt\.\s*)?POB\b:?\s*([^;]+)/gi)].map((m) => m[1].trim().replace(/\.$/, ''));
  const docs = (word) => [...r.matchAll(new RegExp(`(?:^|;)\\s*(?:alt\\.\\s*)?${word}\\s+([A-Z0-9][A-Z0-9-]{3,})(\\s+\\([^)]+\\))?`, 'gi'))].map((m) => `${m[1]}${m[2] || ''}`);
  return {
    born: dobs.length ? [...new Set(dobs)].join('; ') : null, years, nationality: nats.length ? nats.join('; ') : null,
    placeOfBirth: pobs.length ? [...new Set(pobs)].join('; ') : null, passports: docs('Passport(?: No\\.?)?'), nationalIds: docs('National ID No\\.?'),
  };
}

// The year-of-birth rule: a person match is cleared when the owner's year of birth is more than
// `tolerance` years away from every year of birth on the list entry. An entry without one is never cleared.
export function birthYearClears(born, years, tolerance = 1) {
  const y = Number(String(born || '').slice(0, 4));
  if (!y || !years?.length) return false;
  return years.every((x) => Math.abs(Number(x) - y) > tolerance);
}

// The year-of-birth rule over the possible matches of one owner or director, each { id, name (the entry's
// primary name), years }: returns the ids it clears. A match is cleared when the owner's year is more than
// `tolerance` years from every year of birth on its entry, unless another matched entry under the same primary
// name, usually the same person on another list, gives no year or one within it. Lists sometimes give one
// person different years, and each list's ownership rule needs that person's own entry left for the reviewer.
const nameKey = (n) => normalize(n).split(' ').filter(Boolean).sort().join(' ');
export function clearedByBirthYear(born, matches, tolerance = 1) {
  const clears = (m) => birthYearClears(born, m.years, tolerance);
  const kept = new Set(matches.filter((m) => !clears(m)).map((m) => nameKey(m.name)));
  return new Set(matches.filter((m) => clears(m) && !kept.has(nameKey(m.name))).map((m) => m.id));
}

// "same" or "differs" for the year of birth and the nationality, or null when either side is missing. A year of
// birth one year from one of the entry's is "within a year", which the year-of-birth rule leaves open.
export function compareOwner(owner, entry) {
  const f = listFacts(entry);
  const year = owner?.born ? String(owner.born).slice(0, 4) : null;
  const near = (y) => Math.abs(Number(y) - Number(year)) <= 1;
  const born = year && f.years.length ? (f.years.includes(year) ? 'same' : f.years.some(near) ? 'within a year' : 'differs') : null;
  const listed = (f.nationality || '').toLowerCase();
  const nationality = owner?.nationality && listed ? (countrySpellings(owner.nationality).some((x) => listed.includes(x)) ? 'same' : 'differs') : null;
  return { ...f, bornCompared: born, nationalityCompared: nationality };
}

// Company registration, tax and license numbers on a list entry. OFAC remarks write "Registration Number
// 1027700012345 (Russia)", "alt. License 1066766 (United Arab Emirates)" or "Tax ID No. 7704..."; the UK
// details "registration 123, 456"; EU remarks "Registration number: ...".
const ID_LABELS = [
  'registration number', 'registration id', 'registration no.', 'registration', 'business registration number', 'company number',
  'uk company number', 'commercial registry number', 'commercial registration number', 'tax id no.', 'tax identification number',
  'license', 'licence', 'trade license no.', 'trade license number', 'unified social credit code (uscc)', 'legal entity number',
  'government gazette number', 'chamber of commerce number', 'istanbul chamber of comm. no.', 'c.r. no.', 'c.i.n.',
  'enterprise number', 'business number', 'public registration number', 'central registration system number',
  'economic register number (cbls)', 'folio mercantil no.', 'matricula mercantil no', 'r.f.c.', 'v.a.t. number',
  'identification number', 'd-u-n-s number',
].sort((a, b) => b.length - a.length).map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const ID_PART = new RegExp(`^(?:alt\\.\\s+)?(${ID_LABELS.join('|')})\\s*:?\\s*(.+?)\\s*(?:\\(([^)]*)\\))?$`, 'i');
export const normId = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function companyIds(entry) {
  const out = [];
  for (const part of String(entry?.remarks || '').split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = ID_PART.exec(part.replace(/\.$/, ''));
    if (!m) continue;
    for (const value of m[2].split(/,\s*/)) {
      const v = value.trim();
      if (/\d/.test(v) && normId(v).length >= 3) out.push({ label: m[1], value: v, country: m[3] || null });
    }
  }
  return out;
}

// "same" when the vendor's registration or license number is one the entry gives, "differs" when the
// entry gives numbers and none is the vendor's, null when either side has none.
export function compareRegistration(registrationNumber, entry) {
  const mine = normId(registrationNumber);
  const ids = companyIds(entry);
  if (!mine || !ids.length) return { ids, registrationCompared: null };
  return { ids, registrationCompared: ids.some((x) => normId(x.value) === mine) ? 'same' : 'differs' };
}
