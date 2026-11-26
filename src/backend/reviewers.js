// Who decides possible matches: anyone who can open the work item, or only the members of one Jira
// group chosen in Settings, so the person who asked for a vendor is not the one who clears it.
import { route } from '@forge/api';
import { jira } from './jira.js';
import { getSetting } from './db.js';

export const reviewerGroup = () => getSetting('reviewers', null);

export async function mayReview(accountId) {
  const g = await reviewerGroup();
  if (!g?.groupId) return { allowed: true, group: null };
  if (!accountId) return { allowed: false, group: g.name };
  const groups = await jira(route`/rest/api/3/user/groups?accountId=${accountId}`).catch(() => []);
  return { allowed: (groups || []).some((x) => x.groupId === g.groupId), group: g.name };
}

export async function assertReviewer(accountId) {
  const r = await mayReview(accountId);
  if (!r.allowed) throw new Error(`Only members of the Jira group ${r.group} can record review decisions.`);
}

export async function findGroups() {
  const res = await jira(route`/rest/api/3/groups/picker?query=&maxResults=100`);
  return (res?.groups || []).map((g) => ({ groupId: g.groupId, name: g.name }));
}

export async function isJiraAdmin(accountId) {
  if (!accountId) return false;
  const res = await jira(route`/rest/api/3/permissions/check`, 'POST', { accountId, globalPermissions: ['ADMINISTER'] });
  return (res?.globalPermissions || []).includes('ADMINISTER');
}
