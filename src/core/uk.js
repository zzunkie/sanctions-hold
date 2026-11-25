// Parse the UK Sanctions List (FCDO) XML export into list entries in the same shape as the OFAC
// ones. Only individuals and entities under an asset freeze are kept; ships and designations
// without an asset freeze (travel ban only, for example) are left out.
// Source: https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml, Open Government Licence v3.0.

export const UK_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(String(s ?? '')).replace(/\s+/g, ' ').trim();

const one = (xml, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? clean(m[1]) : null;
};
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);

// "The Russia (Sanctions) (EU Exit) Regulations 2019" -> "Russia".
export const regimeShort = (r) => {
  const m = /^The (.+?) \(Sanctions\)/i.exec(r || '');
  return m ? m[1].replace(/^(?:Republic of )/i, '') : (r || '').replace(/^The /, '');
};

// An individual's name as "SURNAME, Given Middle", like the OFAC lists; an entity's as written.
function nameOf(xml, individual) {
  const parts = [1, 2, 3, 4, 5].map((i) => one(xml, `Name${i}`)).filter(Boolean);
  const last = one(xml, 'Name6');
  if (individual && last && parts.length) return `${last}, ${parts.join(' ')}`;
  return [...parts, last].filter(Boolean).join(' ');
}

export function parseUkXml(text) {
  const generated = one(text.slice(0, 2000), 'DateGenerated'); // dd/mm/yyyy
  const entries = [];
  for (const d of all(text, 'Designation')) {
    const kindRaw = one(d, 'IndividualEntityShip');
    const kind = kindRaw === 'Individual' ? 'individual' : kindRaw === 'Entity' ? 'entity' : null;
    if (!kind || one(d, 'AssetFreeze') !== 'true') continue;
    const id = one(d, 'UniqueID');
    if (!id) continue;
    const names = all(d, 'Name').map((n) => ({
      name: nameOf(n, kind === 'individual'),
      type: (one(n, 'NameType') || '').toLowerCase(),
      weak: /low quality/i.test(one(n, 'AliasStrength') || ''),
    })).filter((n) => n.name);
    const primary = names.find((n) => n.type === 'primary name') || names[0];
    if (!primary) continue;
    const aliases = names.filter((n) => n !== primary && n.name !== primary.name).map((n) => ({
      t: n.type.startsWith('primary name variation') ? 'variation' : n.weak ? 'weak aka' : 'aka',
      n: n.name,
    }));
    const addresses = all(d, 'Address').map((a) => ({
      a: [1, 2, 3, 4, 5].map((i) => one(a, `AddressLine${i}`)).filter(Boolean).join(', ') || null,
      c: one(a, 'AddressLine6'),
      k: one(a, 'AddressCountry'),
    })).filter((a) => a.a || a.c || a.k);
    const facts = [];
    const dobs = all(d, 'DOB').map(clean).filter(Boolean);
    if (dobs.length) facts.push(`DOB ${dobs.join(', ')}`);
    const nat = all(d, 'Nationality').map(clean).filter(Boolean);
    if (nat.length) facts.push(`nationality ${nat.join(', ')}`);
    const reg = all(d, 'BusinessRegistrationNumber').map(clean).filter(Boolean);
    if (reg.length) facts.push(`registration ${reg.join(', ')}`);
    const other = one(d, 'OtherInformation');
    if (other) facts.push(other);
    const reasons = one(d, 'UKStatementofReasons');
    if (reasons) facts.push(`Statement of reasons: ${reasons}`);
    const positions = all(d, 'Position').map(clean).filter(Boolean);
    entries.push({
      id: `UK:${id}`,
      list: 'UK',
      uniqueId: id,
      entNum: Number(one(d, 'OFSIGroupID')) || 0,
      name: primary.name,
      kind,
      programs: [regimeShort(one(d, 'RegimeName'))].filter(Boolean),
      title: positions.join('; ') || null,
      remarks: facts.join('; ') || null,
      aliases,
      addresses,
      designated: one(d, 'DateDesignated'),
      source: one(d, 'DesignationSource'),
    });
  }
  return { generated, entries };
}
