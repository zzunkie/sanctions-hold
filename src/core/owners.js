// Owners and directors of a counterparty. They are stored as text such as "Ali Kalhor (60%)" or
// "Sara Haddad (director)", so CSV files, forms and agents can all write them the same way.

const ROLE = /\b(director|officer|board member|chair(?:man|woman|person)?|ceo|cfo|manager|managing director|secretary)\b/i;
const SHARE = /(\d{1,3}(?:[.,]\d+)?)\s*%/;

export function parseOwner(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const share = SHARE.exec(raw);
  const role = ROLE.exec(raw);
  const name = raw
    .replace(SHARE, ' ')
    .replace(ROLE, ' ')
    .replace(/\b(owner|shareholder|beneficial owner|ubo)\b/gi, ' ')
    .replace(/[()[\],:;]+/g, ' ')
    .replace(/(^|\s)[-–]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  const pct = share ? Math.min(100, Number(share[1].replace(',', '.'))) : null;
  return { name, role: role && !share ? 'director' : 'owner', share: Number.isFinite(pct) ? pct : null };
}

export function formatOwner(o) {
  if (!o?.name) return '';
  if (o.role === 'director') return `${o.name} (director)`;
  return o.share != null ? `${o.name} (${o.share}%)` : o.name;
}

// Accepts an array of strings or {name, role, share} objects, or one string separated by ; or new lines.
export function ownerList(v) {
  let items = v;
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { items = JSON.parse(v); } catch { items = v; } }
  if (!Array.isArray(items)) items = String(items ?? '').split(/[;\n]/);
  const out = [];
  for (const item of items) {
    const o = typeof item === 'object' && item ? { name: String(item.name || '').trim(), role: item.role === 'director' ? 'director' : 'owner', share: item.share == null || item.share === '' ? null : Number(item.share) } : parseOwner(item);
    if (o?.name) out.push(o);
  }
  return out.slice(0, 20);
}

export const ownerStrings = (v) => ownerList(v).map(formatOwner);

// "Ali Kalhor (60%)", "Ali Kalhor (60%) and Omar Nasser (10%)", "A (20%), B (10%) and C (director)".
export function peopleText(people, { withShare = true } = {}) {
  const parts = (people || []).map((o) => (withShare ? formatOwner(o) : o.name));
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
export const ownerNames = (v) => ownerList(v).map((o) => o.name);
