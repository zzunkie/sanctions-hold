// Jira events: a new work item in a watched project is screened from its summary; a move into the
// Approved status is recorded with the screening result it passed on.
import api, { route } from '@forge/api';
import { ensureSchema, q, nowDt, logEvent, getSetting } from './backend/db.js';
import { byIssue, createCounterparty, updateCounterparty } from './backend/counterparties.js';
import { vendorFieldId, detailsFromField } from './backend/vendor-field.js';
import { screenCounterparties } from './backend/screening.js';
import { setProperty } from './backend/jira.js';
import { CP_PROPERTY } from './backend/setup.js';
import { COUNTRY_NAMES } from './core/sample.js';

const PREFIX = /^\s*(new\s+)?(vendor|supplier|counterparty|customer|partner)(\s+(request|onboarding|setup))?\s*[:\-–]\s*/i;
export const nameFromSummary = (s) => String(s || '').replace(PREFIX, '').trim();

// Inline nodes join directly; block nodes (paragraphs, list items) go on their own lines.
const INLINE_PARENTS = new Set(['paragraph', 'heading']);
const adfText = (node) => (typeof node === 'string' ? node : node?.text || (node?.content || []).map(adfText).join(INLINE_PARENTS.has(node?.type) ? '' : '\n'));
const BY_NAME = Object.fromEntries(Object.entries(COUNTRY_NAMES).map(([k, v]) => [v.toLowerCase(), k]));

// "Country: ..." and "Owners: a, b" lines in the description, as a request form would write them.
export function detailsFromDescription(description) {
  const text = adfText(description);
  const c = /country\s*:\s*([^\n.]+)/i.exec(text)?.[1]?.trim();
  const o = /owners?\s*:\s*([^\n]+)/i.exec(text)?.[1]?.replace(/\.$/, '');
  const country = c ? (c.length === 2 ? c.toUpperCase() : BY_NAME[c.toLowerCase()] || null) : null;
  const owners = o && !/not given|none|n\/a/i.test(o) ? o.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
  return { country, owners };
}

export async function onIssueCreated(event) {
  const issue = event.issue;
  const projectKey = issue?.fields?.project?.key;
  await ensureSchema();
  const projects = await getSetting('projects', []);
  if (!projects.includes(projectKey) || issue.fields?.issuetype?.subtask) return;
  if (await byIssue(issue.key)) return;
  const name = nameFromSummary(issue.fields?.summary);
  if (!name) return;
  // Country and owners come from the Vendor details field; without it, from "Country:" and
  // "Owners:" lines in the description. The event payload may leave both out, so read them from Jira.
  const fieldId = await vendorFieldId().catch(() => null);
  let fields = issue.fields || {};
  if ((fieldId && fields[fieldId] === undefined) || fields.description === undefined) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issue.key}?fields=description${fieldId ? `,${fieldId}` : ''}`);
    if (res.ok) fields = { ...fields, ...(await res.json()).fields };
  }
  const fromField = fieldId ? detailsFromField(fields[fieldId]) : null;
  const { country, owners, address = null, registrationNumber = null } = fromField?.owners?.length || fromField?.country || fromField?.address || fromField?.registrationNumber ? fromField : detailsFromDescription(fields.description);
  const id = await createCounterparty({ name, country, owners, address, registrationNumber, issueKey: issue.key, source: 'jira' }, event.atlassianId || 'jira');
  await setProperty(issue.key, CP_PROPERTY, { counterpartyId: id }).catch(() => null);
  await screenCounterparties([id], { actor: 'jira', reason: 'work item created' });
}

export async function onIssueUpdated(event) {
  await ensureSchema();
  const fieldId = await vendorFieldId().catch(() => null);
  if (fieldId && event.changelog?.items?.some((i) => i.fieldId === fieldId)) await onVendorFieldEdited(event, fieldId);
  const change = event.changelog?.items?.find((i) => i.fieldId === 'status' || i.field === 'status');
  if (!change) return;
  const cp = await byIssue(event.issue.key);
  if (!cp) return;
  const onboarding = await getSetting('onboarding', null);
  const approved = (onboarding?.statusId && String(change.to) === String(onboarding.statusId)) || /approv/i.test(change.toString || '');
  if (!approved) return;
  if (!cp.approved_at) await q('UPDATE counterparty SET approved_at = ?, approved_by = ? WHERE id = ?', nowDt(), event.atlassianId || null, cp.id);
  await logEvent({
    counterpartyId: cp.id, issueKey: event.issue.key, type: 'approved', actor: event.atlassianId || 'jira',
    detail: { status: cp.status, screenedAt: cp.screened_at, listVersion: cp.screened_version, to: change.toString },
  });
}

// Someone edited the Vendor details field: store the new details and screen again.
async function onVendorFieldEdited(event, fieldId) {
  const cp = await byIssue(event.issue.key);
  if (!cp) return;
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}?fields=${fieldId}`);
  if (!res.ok) return;
  const d = detailsFromField((await res.json()).fields?.[fieldId]);
  if (!d) return;
  await updateCounterparty(cp.id, { name: cp.name, country: d.country, owners: d.owners, address: d.address, registrationNumber: d.registrationNumber }, event.atlassianId || 'jira');
  await screenCounterparties([cp.id], { actor: event.atlassianId || 'jira', reason: 'Vendor details edited' });
}
