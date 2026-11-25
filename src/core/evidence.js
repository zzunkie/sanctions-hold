// What a list entry says about a listed person, and how it compares with what the vendor gave for
// an owner or director. OFAC remarks and the UK details both carry "DOB ..." and "nationality ..."
// (OFAC also "citizen ..."); an entry can give several dates of birth.
import { COUNTRY_NAMES } from './sample.js';
import { countryNameOf } from './countries.js';

export const countrySpellings = (c) => [COUNTRY_NAMES[String(c || '').toUpperCase()], countryNameOf(c)].filter(Boolean).map((x) => x.toLowerCase());

export function listFacts(entry) {
  const r = entry?.remarks || '';
  const dobs = [...r.matchAll(/\bDOB:?\s*([^;]+)/gi)].map((m) => m[1].trim());
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
