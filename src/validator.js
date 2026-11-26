// Workflow validator: the Approve transition cannot pass while the vendor has a possible sanctions match
// waiting for review, or a confirmed one.
import { ensureSchema, q, logEvent, getSetting } from './backend/db.js';
import { byIssue } from './backend/counterparties.js';
import { MAY_APPROVE, assess } from './core/decision.js';
import { peopleText } from './core/owners.js';

const plural = (n, one, many) => (n === 1 ? one : many);

export async function validate(args) {
  const key = args?.issue?.key;
  if (!key) return { result: true };
  await ensureSchema();
  const cp = await byIssue(key);
  if (!cp) {
    return { result: false, errorMessage: 'Sanctions Hold: this vendor has not been screened. Enter its legal name in the "Sanctions Hold" panel first.' };
  }
  if (MAY_APPROVE.has(cp.status)) return { result: true };
  if (cp.status === 'unscreened') {
    return { result: false, errorMessage: `Sanctions Hold: ${cp.name} has not been screened yet. Try again in a minute.` };
  }
  const hits = await q(`SELECT entry_id, matched_name, queried_name, score, status, active FROM hit WHERE counterparty_id = ?
                        AND (status = 'confirmed' OR (status = 'pending' AND active = 1)) ORDER BY status, score DESC`, cp.id);
  const a = assess(hits, cp, { ownerRule: 'fifty', ...(await getSetting('policy', {})) });
  const top = hits[0];
  const people = peopleText(a.people, { withShare: false });
  const withShares = peopleText(a.people);
  await logEvent({ counterpartyId: cp.id, issueKey: key, type: 'approval_blocked', detail: { status: cp.status, reason: a.reason, matches: hits.length, listVersion: cp.screened_version }, actor: 'workflow' });
  const no = (text) => ({ result: false, errorMessage: `Sanctions Hold: ${text}` });
  if (a.reason === 'company') return no(`${cp.name} has a confirmed sanctions list match (${hits.find((h) => h.status === 'confirmed')?.matched_name || 'a listed party'}) and cannot be approved.`);
  if (a.reason === 'fifty-percent') return no(`${cp.name} cannot be approved. ${people}, confirmed as OFAC-listed, ${(a.people || []).length === 1 ? 'holds' : 'hold'} ${a.share}% of the company, which blocks it under OFAC's 50 Percent Rule.`);
  if (a.reason === 'uk-majority') return no(`${cp.name} cannot be approved. ${people}, confirmed as listed on the UK Sanctions List, holds ${a.share}% of the company, which puts it under the UK asset freeze.`);
  if (a.reason === 'eu-ownership') return no(`${cp.name} cannot be approved. ${people}, confirmed on the EU consolidated list, ${(a.people || []).length === 1 ? 'holds' : 'hold a combined'} ${a.share}% of the company, which blocks it under the EU ownership rule.`);
  if (a.reason === 'share-unknown') return no(`${cp.name} cannot be approved. ${people} ${(a.people || []).length === 1 ? 'is' : 'are'} confirmed as listed without an ownership share; enter the share in Vendor details.`);
  if (a.reason === 'listed-person' || a.reason === 'reviewer-blocked') return no(`${cp.name} cannot be approved because of a confirmed listed owner or director: ${withShares}.`);
  if (a.reason === 'minority') return no(`${cp.name} has a confirmed listed owner or director: ${withShares}. Approve after a reviewer chooses Proceed in Sanctions Hold (View app actions).`);
  const n = hits.filter((h) => h.status === 'pending').length;
  return no(`${cp.name} has ${n} possible sanctions ${plural(n, 'match', 'matches')} waiting for review (closest: ${top?.matched_name}, score ${Number(top?.score).toFixed(2)}). Approve after a reviewer decides in Sanctions Hold (View app actions).`);
}
