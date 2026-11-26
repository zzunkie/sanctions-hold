// Jira REST helpers (as the app).
import api, { route, assumeTrustedRoute, getAppContext } from '@forge/api';

export async function jira(path, method = 'GET', body) {
  const res = await api.asApp().requestJira(path, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`Jira ${method} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Creates a work item at Medium priority, so an onboarding request does not open as Critical on
// sites whose default is higher; a project without that priority gets its default.
export async function createIssue(fields) {
  try {
    return await jira(route`/rest/api/3/issue`, 'POST', { fields: { ...fields, priority: { name: 'Medium' } } });
  } catch (e) {
    if (e.status !== 400 || !/priority/i.test(e.message)) throw e;
    return jira(route`/rest/api/3/issue`, 'POST', { fields });
  }
}

// Opens the wider Sanctions Hold panel on a work item, the way Jira records a panel added from
// View app actions. A work item that already has the panel, or where someone removed it, is left alone.
export async function showPanel(issueKey) {
  const { appAri, environmentAri } = getAppContext();
  const key = `ari:cloud:ecosystem::extension/${appAri.appId}/${environmentAri.environmentId}/static/sanctions-hold-panel`;
  // The key holds slashes, which route`` refuses; both parts are encoded here.
  const path = assumeTrustedRoute(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(key)}`);
  const res = await api.asApp().requestJira(path, { headers: { Accept: 'application/json' } });
  if (res.ok) return;
  await jira(path, 'PUT', [{ added: Date.now(), id: Math.random().toString(16).slice(2, 10), collapsed: false }]);
}

// The work type for a work item the app opens in another team's project: Task when the project has it.
export async function taskType(projectKey) {
  const res = await jira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  const types = (res?.issueTypes || res?.values || []).filter((t) => !t.subtask);
  return types.find((t) => t.name === 'Task') || types[0] || null;
}

export async function linkIssues(fromKey, toKey) {
  await jira(route`/rest/api/3/issueLink`, 'POST', { type: { name: 'Relates' }, inwardIssue: { key: fromKey }, outwardIssue: { key: toKey } });
}

export async function setProperty(issueKey, key, value) {
  await jira(route`/rest/api/3/issue/${issueKey}/properties/${key}`, 'PUT', value);
}

// ADF paragraphs; a part may be a string, where a newline is a line break, or { mention: accountId }.
const lines = (t) => t.split('\n').flatMap((l, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(l ? [{ type: 'text', text: l }] : [])]);
export const adf = (...paragraphs) => ({
  type: 'doc',
  version: 1,
  content: paragraphs.filter(Boolean).map((p) => ({
    type: 'paragraph',
    content: (Array.isArray(p) ? p : [p]).filter(Boolean).flatMap((x) => (typeof x === 'string' ? lines(x) : [{ type: 'mention', attrs: { id: x.mention } }])),
  })),
});

export async function comment(issueKey, ...paragraphs) {
  await jira(route`/rest/api/3/issue/${issueKey}/comment`, 'POST', { body: adf(...paragraphs) });
}

export async function addLabel(issueKey, label) {
  await jira(route`/rest/api/3/issue/${issueKey}`, 'PUT', { update: { labels: [{ add: label }] } });
}

export async function removeLabel(issueKey, label) {
  await jira(route`/rest/api/3/issue/${issueKey}`, 'PUT', { update: { labels: [{ remove: label }] } });
}

export async function listProjects() {
  const res = await jira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`);
  return (res.values || []).map((p) => ({ key: p.key, name: p.name, style: p.style, type: p.projectTypeKey }));
}
