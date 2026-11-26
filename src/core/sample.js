// Sample vendors for trying the app. The ordinary vendors are invented names; the demo cases use
// real OFAC, UK and EU list names (spelling variants, an owner, a later designation) or a near miss.

const PREFIX = [
  'Northwind', 'Bluefield', 'Harbor Point', 'Cedar Ridge', 'Silverline', 'Granite Peak', 'Riverbend', 'Oakmont',
  'Lakeshore', 'Summit Ridge', 'Pinecrest', 'Brightwater', 'Ironwood', 'Westbrook', 'Clearview', 'Redstone',
  'Maple Grove', 'Stonebridge', 'Highland', 'Driftwood', 'Copperfield', 'Fairhaven', 'Elmstead', 'Bayview',
  'Willowbrook', 'Kestrel', 'Larkspur', 'Meadowlark', 'Quarry Lane', 'Tidewater',
];
const NOUN = [
  'Packaging', 'Logistics', 'Industrial Supply', 'Office Products', 'Software', 'Analytics', 'Consulting',
  'Printing', 'Electrical', 'Facility Services', 'Freight', 'Components', 'Plastics', 'Textiles', 'Foods',
  'Labs', 'Staffing', 'Security Services', 'Cleaning', 'Media', 'Instruments', 'Metalworks', 'Translation',
  'Catering', 'Data Systems',
];
const COUNTRY = [
  ['US', 'Inc.'], ['US', 'LLC'], ['GB', 'Ltd'], ['DE', 'GmbH'], ['FR', 'SAS'], ['NL', 'B.V.'], ['IN', 'Pvt. Ltd.'],
  ['SG', 'Pte. Ltd.'], ['CA', 'Inc.'], ['JP', 'K.K.'], ['KR', 'Co., Ltd.'], ['MX', 'S.A. de C.V.'], ['AE', 'FZE'],
  ['IE', 'Ltd'], ['US', 'Corp.'],
];
const OWNERS = [
  'Laura Whitfield', 'Martin Keller', 'Priya Raman', 'Tomas Lindqvist', 'Hannah Okafor', 'Daniel Moreau',
  'Grace Thornton', 'Kenji Watanabe', 'Sofia Brandt', 'Owen Gallagher', 'Ines Duarte', 'Lucas Fournier',
];

// Countries are ISO 3166 alpha-2 codes; list entries carry country names.
export const COUNTRY_NAMES = {
  US: 'United States', GB: 'United Kingdom', DE: 'Germany', FR: 'France', NL: 'Netherlands', IN: 'India',
  SG: 'Singapore', CA: 'Canada', JP: 'Japan', KR: 'Korea, South', MX: 'Mexico', AE: 'United Arab Emirates',
  IE: 'Ireland', LT: 'Lithuania', IR: 'Iran', TR: 'Turkey', CN: 'China', HK: 'Hong Kong', RU: 'Russia', LB: 'Lebanon',
};

const DAY = 864e5;

export function ordinaryVendors(n = 190, now = Date.now()) {
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < n && i < n * 4; i += 1) {
    const prefix = PREFIX[i % PREFIX.length];
    const noun = NOUN[(i * 7 + Math.floor(i / PREFIX.length)) % NOUN.length];
    const [country, suffix] = COUNTRY[(i * 3 + Math.floor(i / 5)) % COUNTRY.length];
    const name = `${prefix} ${noun} ${suffix}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      key: `v${String(out.length + 1).padStart(3, '0')}`,
      name,
      country,
      owners: i % 4 === 0 ? [`${OWNERS[i % OWNERS.length]} (100%)`] : [],
      approvedAt: i % 6 === 5 ? null : new Date(now - (10 + ((i * 37) % 300)) * DAY).toISOString(),
    });
  }
  return out;
}

// Demo cases. `request`: a pending onboarding request in Jira. `approved`: an approved vendor.
export function demoVendors(now = Date.now()) {
  return [
    {
      key: 'd-typo', name: 'Dexterus Global DMCC', country: 'AE', owners: ['Rashid Al Mansoori (100%)'], approvedAt: null, request: true,
      note: 'Spelling variant of a name on the SDN list.',
    },
    {
      key: 'd-owner', name: 'Crescent Bay Marine Services FZE', country: 'AE', owners: ['Ali Kalhor (60%, born 1963, nationality Iran)', 'Sara Haddad (40%)'], approvedAt: null, request: true,
      note: 'The company name is clean; an owner with 60% is on the SDN list (name in a different order), so the 50 Percent Rule blocks it once confirmed.',
    },
    {
      key: 'd-near', name: 'Atlis Shipping Pte. Ltd.', country: 'SG', owners: ['Tan Wei Ming (70%)', 'Lim Siew Ling (30%)'], approvedAt: null, request: true,
      note: 'Close to a list alias but a different company.',
    },
    {
      key: 'd-clean', name: 'Harbor Point Packaging LLC', country: 'US', owners: ['Laura Whitfield (100%)'], approvedAt: null, request: true,
      note: 'No match.',
    },
    {
      key: 'd-later', name: 'Nordic International Trading L.L.C.', country: 'AE', owners: [], approvedAt: new Date(now - 64 * DAY).toISOString(), request: true,
      note: 'Approved before its designation; the replayed list update matches it.',
    },
    {
      key: 'd-minority', name: 'Lakshmi Polymers Pvt. Ltd.', country: 'IN', owners: ['Meera Iyer (80%)', 'Suniel Kumar Sharma (20%, born 1979, nationality India)'], approvedAt: null, request: true,
      note: 'A 20% owner is on the SDN list; below 50%, so a reviewer decides whether to proceed.',
    },
    {
      key: 'd-uk', name: 'Lowlands Metal Trading B.V.', country: 'NL', owners: ['Alexander Tattersall (60%, born 1961, nationality Netherlands)', 'Femke de Vries (40%)'], approvedAt: null, request: true,
      note: 'The 60% owner is on the UK Sanctions List only (listed with two middle names), so the UK ownership test blocks it once confirmed.',
    },
    {
      key: 'd-namesake', name: 'Savannah Freight Ltd', country: 'KE', owners: ['Yusuf Ibrahim (100%, born 1990, nationality Kenya)'], approvedAt: null, request: true,
      note: 'The owner shares a common name with two listed people; his year of birth and nationality differ from both, so a reviewer dismisses them.',
    },
    {
      key: 'd-eu', name: 'Klaipeda Machine Parts UAB', country: 'LT', owners: ['Ruta Petrauskiene (45%)', 'Konstantin Nikolayev (30%, born 1971, nationality Russia)', 'Sergey Atlivanchik (25%, born 1980, nationality Russia)'], approvedAt: null, request: true,
      note: 'Two owners with 30% and 25% are on the EU list only. The EU adds up the holdings of listed owners, so once both are confirmed their 55% blocks it.',
    },
    {
      key: 'd-later-us', name: 'Berkeley Trading LLC', country: 'US', owners: [], approvedAt: new Date(now - 210 * DAY).toISOString(),
      note: 'Same name as a later designation in another country.',
    },
  ];
}

export function sampleVendors(now = Date.now()) {
  return [...demoVendors(now), ...ordinaryVendors(187, now)];
}

// The demo holds back the newest SDN designations at the first import and adds them back as a
// list update, so the effect of a new designation on approved vendors can be shown on day one.
export const DEMO_HOLD_BACK_FROM = 59175;
