// One-click Jira setup, run from the queue because project creation takes several seconds:
// a company-managed "Vendor onboarding" project whose "Approve" transition runs the Sanctions
// Hold check, and onboarding requests for the sample vendors.
import api, { route } from '@forge/api';
import { q, getSetting, setSetting, logEvent } from './db.js';
import { jira, setProperty, adf } from './jira.js';
import { demoVendors } from '../core/sample.js';
import { addFieldToProjectScreens, setVendorField } from './vendor-field.js';
import { syncWorkItem } from './screening.js';

const TEMPLATE = 'com.atlassian.jira-core-project-templates:jira-core-simplified-task-tracking';
const VALIDATOR = '/static/approval-check';
export const CP_PROPERTY = 'sanctions-hold-counterparty';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(path) {
  const res = await api.asApp().requestJira(path);
  return res.status === 200;
}

async function createProject(baseKey, baseName, description, leadAccountId) {
  for (let n = 1; n <= 5; n += 1) {
    const key = n === 1 ? baseKey : `${baseKey}${n}`;
    const name = n === 1 ? baseName : `${baseName} ${n}`;
    if (await exists(route`/rest/api/3/project/${key}`)) continue;
    try {
      await jira(route`/rest/api/3/project`, 'POST', { key, name, description, projectTypeKey: 'business', projectTemplateKey: TEMPLATE, leadAccountId });
    } catch (e) {
      if (e.status === 400 && /name|key/i.test(e.message)) continue;
      throw e;
    }
    const p = await jira(route`/rest/api/3/project/${key}`);
    const task = p.issueTypes.find((t) => !t.subtask);
    return { projectKey: key, projectId: String(p.id), taskTypeId: task.id };
  }
  throw new Error(`Could not find a free project key for ${baseKey}.`);
}

async function existingStatus(name) {
  const res = await jira(route`/rest/api/3/statuses/search?searchString=${name}&maxResults=50`);
  return (res.values || []).find((s) => s.name.toLowerCase() === name.toLowerCase() && s.scope?.type === 'GLOBAL') || null;
}

// Workflow changes on the new project: an "Approved" status reached through "Approve", which runs
// the Sanctions Hold check; a "Sanctions review" status where the app moves a new vendor with an open
// match and an approved vendor that a list update matches, with "Approve" back out of it; a "Blocked"
// status for a vendor that a confirmed match blocks; and the template's "Done" transition renamed
// so that closing a request is not read as approving it. Returns the status ids.
export const HOLD_STATUS = 'Sanctions review';
export const HOLD_TRANSITION = 'Hold for sanctions review';
export const BLOCK_STATUS = 'Blocked';
export const BLOCK_TRANSITION = 'Block for sanctions';

async function statusRef(name, statusCategory, description) {
  const found = await existingStatus(name);
  return found
    ? { ref: found.id, status: { id: found.id, name: found.name, statusCategory: found.statusCategory, statusReference: found.id, description: found.description || '' } }
    : (() => { const ref = crypto.randomUUID(); return { ref, status: { name, statusCategory, statusReference: ref, description } }; })();
}

export async function addApproveTransition({ projectId, taskTypeId }) {
  const cap = await jira(route`/rest/api/3/workflows/capabilities?projectId=${projectId}&issueTypeId=${taskTypeId}`);
  const rule = (cap.forgeRules || []).find((r) => r.id.endsWith(VALIDATOR));
  if (!rule) throw new Error('The Sanctions Hold check is not offered for this project. It must be company-managed.');
  const read = await jira(route`/rest/api/3/workflows`, 'POST', { projectAndIssueTypes: [{ projectId, issueTypeId: taskTypeId }] });
  const wf = read.workflows[0];
  const todo = read.statuses.find((s) => s.statusCategory === 'TODO');
  const already = wf.transitions.find((t) => (t.validators || []).some((v) => v.parameters?.key === rule.id));
  if (already) {
    const hold = read.statuses.find((s) => s.name === HOLD_STATUS);
    return { approvedId: already.toStatusReference, holdId: hold?.statusReference || null };
  }

  const approved = await statusRef('Approved', 'DONE', 'The vendor is approved for payment and contracts.');
  const hold = await statusRef(HOLD_STATUS, 'IN_PROGRESS', 'The vendor or one of its owners has a possible sanctions list match. A reviewer decides in Sanctions Hold before it can be approved.');
  const blocked = await statusRef(BLOCK_STATUS, 'IN_PROGRESS', 'A reviewer confirmed a sanctions list match that blocks this vendor. Sanctions Hold moves it back to Sanctions review if the decision changes.');
  const statuses = read.statuses.map(({ id, name, statusCategory, statusReference, description }) => ({ id, name, statusCategory, statusReference, description }));
  for (const x of [blocked, hold, approved]) if (!statuses.some((s) => s.statusReference === x.ref)) statuses.splice(1, 0, x.status);
  const layout = wf.statuses.find((s) => s.statusReference === todo.statusReference)?.layout || { x: 0, y: 0 };
  let nextId = Math.max(...wf.transitions.map((t) => Number(t.id) || 0)) + 10;
  const doneRefs = new Set(read.statuses.filter((s) => s.statusCategory === 'DONE').map((s) => s.statusReference));
  // The template's translated title would keep showing "Done", so it is dropped with the rename.
  const untranslated = (props) => Object.fromEntries(Object.entries(props || {}).filter(([k]) => !k.startsWith('jira.i18n.')));
  const transitions = wf.transitions.map((t) => (t.name === 'Done' && doneRefs.has(t.toStatusReference) ? { ...t, name: 'Close without approval', properties: untranslated(t.properties) } : t));
  const body = {
    statuses,
    workflows: [{
      id: wf.id,
      version: wf.version,
      description: wf.description || '',
      startPointLayout: wf.startPointLayout,
      // To Do, Sanctions review, Approved, then the template's other statuses, so the board reads left to right.
      statuses: [
        ...wf.statuses.filter((x) => x.statusReference === todo.statusReference),
        { statusReference: hold.ref, layout: { x: layout.x + 520, y: layout.y + 240 }, properties: {} },
        { statusReference: blocked.ref, layout: { x: layout.x + 780, y: layout.y + 360 }, properties: {} },
        { statusReference: approved.ref, layout: { x: layout.x + 260, y: layout.y + 120 }, properties: {} },
        ...wf.statuses.filter((x) => x.statusReference !== todo.statusReference),
      ],
      transitions: [
        ...transitions,
        {
          id: String(nextId += 0), name: 'Approve', type: 'DIRECTED', toStatusReference: approved.ref,
          links: [{ fromStatusReference: todo.statusReference, fromPort: 3, toPort: 7 }, { fromStatusReference: hold.ref, fromPort: 0, toPort: 4 }],
          validators: [{ ruleKey: 'forge:expression-validator', parameters: { key: rule.id, config: '{}', disabled: 'false', tag: '' } }],
          actions: [], triggers: [], properties: {},
        },
        {
          id: String(nextId += 10), name: HOLD_TRANSITION, type: 'DIRECTED', toStatusReference: hold.ref,
          links: [{ fromStatusReference: approved.ref, fromPort: 4, toPort: 0 }, { fromStatusReference: todo.statusReference, fromPort: 5, toPort: 1 }, { fromStatusReference: blocked.ref, fromPort: 3, toPort: 7 }],
          validators: [], actions: [], triggers: [], properties: {},
        },
        {
          id: String(nextId += 10), name: BLOCK_TRANSITION, type: 'DIRECTED', toStatusReference: blocked.ref,
          links: [{ fromStatusReference: hold.ref, fromPort: 5, toPort: 1 }, { fromStatusReference: todo.statusReference, fromPort: 6, toPort: 2 }, { fromStatusReference: approved.ref, fromPort: 5, toPort: 0 }],
          validators: [], actions: [], triggers: [], properties: {},
        },
      ],
    }],
  };
  const check = await jira(route`/rest/api/3/workflows/update/validation`, 'POST', { payload: body });
  if (check?.errors?.length) throw new Error(`Workflow check failed: ${check.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await jira(route`/rest/api/3/workflows/update`, 'POST', body);
      const id = (name) => res.statuses.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id || null;
      return { approvedId: id('Approved'), holdId: id(HOLD_STATUS) };
    } catch (e) {
      // 409: another workflow update is still running on the site.
      if (e.status !== 409 || attempt >= 5) throw e;
      await wait(3000 * attempt);
    }
  }
}

// Onboarding requests for the demo vendors; the one approved before its designation is moved
// through "Approve" (the check passes because the held-back designation is not loaded yet).
async function sampleRequests(target) {
  const keys = [];
  for (const v of demoVendors().filter((d) => d.request)) {
    const id = `sample-${v.key}`;
    const [cp] = await q('SELECT id, issue_key, status FROM counterparty WHERE id = ?', id);
    if (!cp || cp.issue_key) continue;
    const issue = await jira(route`/rest/api/3/issue`, 'POST', {
      fields: {
        project: { key: target.projectKey },
        issuetype: { id: target.taskTypeId },
        summary: v.name.slice(0, 250),
        labels: ['sanctions-hold-sample'],
        description: adf(`Onboarding request for ${v.name}, from the Sanctions Hold sample.`),
      },
    });
    await setVendorField(issue.key, { country: v.country, owners: v.owners }).catch((e) => console.error('vendor field', issue.key, e.message));
    await q('UPDATE counterparty SET issue_key = ? WHERE id = ?', issue.key, id);
    await setProperty(issue.key, CP_PROPERTY, { counterpartyId: id });
    keys.push(issue.key);
    await syncWorkItem(issue.key, 'todo', cp.status).catch((e) => console.error('hold sample', issue.key, e.message));
    if (v.approvedAt) {
      const t = await jira(route`/rest/api/3/issue/${issue.key}/transitions`);
      const approve = (t.transitions || []).find((x) => x.name === 'Approve');
      if (approve) await jira(route`/rest/api/3/issue/${issue.key}/transitions`, 'POST', { transition: { id: approve.id } }).catch((e) => console.error('approve sample', e.message));
    }
  }
  return keys;
}

export const setupStatus = () => getSetting('setup', null);

export async function runSetup({ accountId }) {
  const state = { state: 'running', startedAt: new Date().toISOString(), steps: [] };
  const step = async (text) => { state.steps.push(text); await setSetting('setup', state); };
  try {
    await step('Creating the Vendor onboarding project');
    const project = await createProject('VEND', 'Vendor onboarding', 'Sanctions Hold: the Approve transition checks the vendor and its owners against the OFAC, UK and EU sanctions lists.', accountId);
    await step('Adding the Approve transition with the sanctions check, and the Sanctions review and Blocked statuses');
    const { approvedId, holdId } = await addApproveTransition(project);
    await setSetting('onboarding', { ...project, statusId: approvedId, holdStatusId: holdId });
    await step('Adding the Vendor details field to the project screens');
    const field = await addFieldToProjectScreens(project.projectId, project.projectKey).catch((e) => ({ error: e.message }));
    state.field = field;
    if (field?.error || !field?.added) console.error('vendor field screens', JSON.stringify(field));
    const projects = new Set(await getSetting('projects', []));
    projects.add(project.projectKey);
    await setSetting('projects', [...projects]);
    await step('Creating sample onboarding requests');
    const samples = await sampleRequests(project);
    await logEvent({ type: 'jira_setup', detail: { project: project.projectKey, samples, field: state.field }, actor: accountId });
    Object.assign(state, { state: 'done', project: project.projectKey, samples, finishedAt: new Date().toISOString() });
    await setSetting('setup', state);
  } catch (e) {
    console.error('setup', e);
    Object.assign(state, { state: 'error', error: String(e.message).slice(0, 500) });
    await setSetting('setup', state);
  }
}
