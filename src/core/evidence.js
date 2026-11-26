// What a list entry says about a listed person, and how it compares with what the vendor gave for
// an owner or director. OFAC remarks and the UK and EU details all carry "DOB ..." and "nationality ..."
// (OFAC also "citizen ..."); an entry can give several dates of birth.
import { COUNTRY_NAMES } from './sample.js';
import { countryNameOf } from './countries.js';

export const countrySpellings = (c) => [COUNTRY_NAMES[String(c || '').toUpperCase()], countryNameOf(c)].filter(Boolean).map((x) => x.toLowerCase());

// OFAC writes "08 Oct 1963", the UK "24/06/1961" (or "--/--/1961"), the EU "1980-01-11"; all are shown as "8 Oct 1963".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (d, m, y) => [Number(d) ? String(Number(d)) : null, MONTHS[Number(m) - 1] || null, y].filter(Boolean).join(' ');
export const fmtDob = (s) => String(s)
  .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => dm(d, m, y))
  .replace(/(\d{2}|--)\/(\d{2}|--)\/(\d{4})/g, (_, d, m, y) => dm(d === '--' ? 0 : d, m === '--' ? 0 : m, y))
  .replace(/\b0(\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, '$1 $2');

export function listFacts(entry) {
  const r = entry?.remarks || '';
  const dobs = [...r.matchAll(/\bDOB:?\s*([^;]+)/gi)].map((m) => fmtDob(m[1].trim()));
  const nats = [...new Set([...r.matchAll(/\b(?:nationality|citizen):?\s*([^;]+)/gi)].map((m) => m[1].trim()))];
  const years = [...new Set(dobs.flatMap((d) => d.match(/\b(?:18|19|20)\d{2}\b/g) || []))];
  return { born: dobs.length ? [...new Set(dobs)].join('; ') : null, years, nationality: nats.length ? nats.join('; ') : null };
}

// "same" or "differs" for the year of birth and the nationality, or null when either side is missing.
export function compareOwner(owner, entry) {
  const f = listFacts(entry);
  const year = owner?.born ? String(owner.born).slice(0, 4) : null;
  const born = year && f.years.length ? (f.years.includes(year) ? 'same' : 'differs') : null;
  const listed = (f.nationality || '').toLowerCase();
  const nationality = owner?.nationality && listed ? (countrySpellings(owner.nationality).some((x) => listed.includes(x)) ? 'same' : 'differs') : null;
  return { ...f, bornCompared: born, nationalityCompared: nationality };
}
