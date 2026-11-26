// All GLEIF LEI records of one country (CC0 1.0): legal name, other names, registration number.
// usage: node scripts/fetch-gleif-country.mjs <CC> <out.json>
import { writeFileSync } from 'node:fs';
const [c, out] = process.argv.slice(2);
const rows = [];
for (let page = 1; ; page++) {
  const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=${c}&page[size]=200&page[number]=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) { console.error(page, res.status); break; }
  const d = await res.json();
  const got = (d.data || []).map((r) => ({ name: r.attributes.entity.legalName.name, other: (r.attributes.entity.otherNames || []).map((o) => o.name), country: c, reg: r.attributes.entity.registeredAs || null, status: r.attributes.entity.status }));
  rows.push(...got);
  if (!got.length || page >= d.meta.pagination.lastPage) break;
}
console.error(c, rows.length, rows.filter((x) => x.reg).length);
writeFileSync(out, JSON.stringify({ source: `GLEIF LEI records (CC0 1.0), api.gleif.org lei-records, all records with legal address in ${c}, fetched ${new Date().toISOString().slice(0, 10)}`, rows }, null, 1));
