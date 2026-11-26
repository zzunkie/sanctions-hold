// Jira REST helpers (as the app).
import api, { route } from '@forge/api';

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

export async function setProperty(issueKey, key, value) {
  await jira(route`/rest/api/3/issue/${issueKey}/properties/${key}`, 'PUT', value);
}

// ADF paragraphs; a part may be a string or { mention: accountId }.
export const adf = (...paragraphs) => ({
  type: 'doc',
  version: 1,
  content: paragraphs.filter(Boolean).map((p) => ({
    type: 'paragraph',
    content: (Array.isArray(p) ? p : [p]).filter(Boolean).map((x) => (typeof x === 'string' ? { type: 'text', text: x } : { type: 'mention', attrs: { id: x.mention } })),
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
