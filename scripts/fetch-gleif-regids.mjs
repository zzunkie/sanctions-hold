// GLEIF LEI records (CC0 1.0): legal name, country and registration number (registeredAs), for testing number search.
// usage: node scripts/fetch-gleif-regids.mjs <page> <out.json>
import { writeFileSync } from 'node:fs';
const [page, out] = process.argv.slice(2);
const CC = ['AE', 'CH', 'CN', 'DE', 'ES', 'FR', 'GB', 'HK', 'IN', 'IT', 'JP', 'KR', 'NL', 'RU', 'SG', 'TR', 'US'];
const rows = [];
for (const c of CC) {
  const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=${c}&page[size]=200&page[number]=${page}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) { console.error(c, res.status); continue; }
  const d = await res.json();
  const got = (d.data || []).map((r) => ({ name: r.attributes.entity.legalName.name, country: c, reg: r.attributes.entity.registeredAs || null }));
  rows.push(...got);
  console.error(c, got.length, got.filter((x) => x.reg).length);
}
writeFileSync(out, JSON.stringify({ source: `GLEIF LEI records (CC0 1.0), api.gleif.org lei-records, page ${page} of 200 per country, fetched ${new Date().toISOString().slice(0, 10)}`, rows }, null, 1));
