// The "Vendor details" Forge custom field: the vendor's country and its owners and directors with
// their shares, entered on the onboarding work item. Its value is { country, owners: [{ name, role, share }] }.
import { route } from '@forge/api';
import { jira } from './jira.js';
import { ownerList, ownerStrings } from '../core/owners.js';

const MODULE = '/static/vendor-details';
let cachedId = null;

export async function vendorFieldId() {
  if (cachedId) return cachedId;
  const fields = await jira(route`/rest/api/3/field`);
  const f = (fields || []).find((x) => String(x.schema?.custom || '').endsWith(MODULE));
  cachedId = f?.id || null;
  return cachedId;
}

export const fieldValue = ({ country, owners }) => ({
  ...(country ? { country: String(country).toUpperCase().slice(0, 2) } : {}),
  owners: ownerList(owners).map((o) => ({ name: o.name, role: o.role, ...(o.role === 'owner' && o.share != null ? { share: o.share } : {}) })),
});

export const detailsFromField = (v) => (v && typeof v === 'object'
  ? { country: v.country || null, owners: ownerStrings(v.owners || []) }
  : null);

export async function setVendorField(issueKey, details) {
  const id = await vendorFieldId();
  if (!id) return false;
  await jira(route`/rest/api/3/issue/${issueKey}`, 'PUT', { fields: { [id]: fieldValue(details) } });
  return true;
}

// Put the field on the project's own create, edit and view screens (the ones named "KEY: ..."), so
// screens shared with other projects are left alone.
export async function addFieldToProjectScreens(projectId, projectKey) {
  const id = await vendorFieldId();
  if (!id) return { added: 0, note: 'field not found' };
  const link = await jira(route`/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`);
  const itss = link.values?.[0]?.issueTypeScreenScheme?.id;
  if (!itss) return { added: 0, note: `no screen scheme: ${JSON.stringify(link).slice(0, 200)}` };
  const mapping = await jira(route`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itss}`);
  const schemeIds = [...new Set((mapping.values || []).map((m) => m.screenSchemeId))];
  const screens = new Set();
  for (const sid of schemeIds) {
    const res = await jira(route`/rest/api/3/screenscheme?id=${sid}`);
    for (const s of res.values || []) Object.values(s.screens || {}).forEach((x) => screens.add(String(x)));
  }
  const own = new Set();
  for (const sid of screens) {
    const res = await jira(route`/rest/api/3/screens?id=${sid}`);
    for (const sc of res.values || []) if (String(sc.name || '').startsWith(`${projectKey}:`)) own.add(String(sc.id));
  }
  let added = 0;
  const errors = [];
  for (const screenId of own) {
    const tabs = await jira(route`/rest/api/3/screens/${screenId}/tabs`);
    const tab = tabs?.[0];
    if (!tab) continue;
    const present = await jira(route`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`);
    if ((present || []).some((f) => f.id === id)) continue;
    try {
      await jira(route`/rest/api/3/screens/${screenId}/tabs/${tab.id}/fields`, 'POST', { fieldId: id });
      added += 1;
    } catch (e) {
      errors.push(`${screenId}: ${e.message.slice(0, 200)}`);
    }
  }
  return { added, screens: [...screens], own: [...own], errors };
}
