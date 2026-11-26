import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Button, Link, Spinner, SectionMessage, SectionMessageAction, EmptyState,
  Tabs, TabList, Tab, TabPanel, DynamicTable, Select, Textfield, Label, FilePicker, CodeBlock, Lozenge, Strong,
  Modal, ModalTransition, ModalHeader, ModalTitle, ModalBody, ModalFooter, xcss,
} from '@forge/react';
import {
  call, StatusLozenge, HitLozenge, MatchEvidence, ReviewForm, ReviewedNote, OwnershipNote, ownerOfHit, placesOfHit, IssueLink, listName, fmtDate, fmtTime, score, fmtVersion, listDates, matchedText, STATUS, countryName,
} from './common.jsx';

const pad = xcss({ paddingTop: 'space.200' });
const narrow = xcss({ width: '320px' });

function useLoad(name, payload, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    call(name, payload).then((data) => setState({ data, error: null, loading: false }), (e) => setState({ data: null, error: e.message, loading: false }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return { ...state, reload: load };
}

const stat = xcss({ paddingInlineEnd: 'space.400' });
const Stat = ({ label, value }) => (
  <Box xcss={stat}>
    <Stack space="space.050">
      <Text color="color.text.subtle">{label}</Text>
      <Heading size="xlarge">{String(value ?? 0)}</Heading>
    </Stack>
  </Box>
);

const JOB_TEXT = {
  'start-demo': 'Loading the OFAC, UK and EU sanctions lists and the sample vendors, then screening every vendor. This takes about three minutes.',
  import: 'Loading the OFAC, UK and EU sanctions lists and screening every vendor again. This takes about three minutes.',
  rescreen: 'Screening every vendor again.',
  accuracy: 'Running the accuracy test on the current lists: about 13,000 searches in the background. The result appears on this tab when it finishes.',
};
const JOB_NAME = { 'start-demo': 'Loading the lists and the sample vendors', import: 'Loading the lists', rescreen: 'Screening every vendor again', accuracy: 'The accuracy test' };

// Polls while a queued job runs, then reloads the page data.
function JobBanner({ jobs, onDone }) {
  const running = Object.values(jobs || {}).filter((j) => j && (j.state === 'running' || j.state === 'queued') && Date.now() - Date.parse(j.startedAt) < (j.type === 'accuracy' ? 45 : 20) * 60 * 1000);
  const failed = Object.values(jobs || {}).filter((j) => j?.state === 'error' && Date.now() - Date.parse(j.finishedAt || j.startedAt) < 60 * 60 * 1000);
  useEffect(() => {
    if (!running.length) return undefined;
    const t = setInterval(async () => {
      const r = await call('jobs').catch(() => null);
      if (r && !Object.values(r.jobs).some((j) => j && (j.state === 'running' || j.state === 'queued'))) onDone();
    }, 5000);
    return () => clearInterval(t);
  }, [running.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (running.length) {
    return (
      <SectionMessage appearance="information">
        <Inline space="space.100" alignBlock="center"><Spinner size="small" label="Working" /><Text>{JOB_TEXT[running[0].type] || running[0].type}</Text></Inline>
      </SectionMessage>
    );
  }
  if (failed.length) return <SectionMessage appearance="error" title="A background job failed"><Text>{`${JOB_NAME[failed[0].type] || failed[0].type} stopped (${failed[0].error}). Start it again.`}</Text></SectionMessage>;
  return null;
}

function JiraSetup({ setup, onDone }) {
  const [state, setState] = useState(setup);
  const running = state?.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      const r = await call('setupStatus').catch(() => null);
      if (!r) return;
      setState(r.setup);
      if (r.setup?.state !== 'running') onDone();
    }, 4000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => { await call('setupJira'); setState({ state: 'running', steps: ['Queued'] }); };
  if (running) {
    return (
      <SectionMessage appearance="information" title="Setting up Jira">
        <Inline space="space.100" alignBlock="center"><Spinner size="small" label="Working" /><Text>{`${state.steps?.[state.steps.length - 1] || 'Starting'}…`}</Text></Inline>
      </SectionMessage>
    );
  }
  return (
    <SectionMessage
      appearance={state?.state === 'error' ? 'error' : 'information'}
      title={state?.state === 'error' ? 'Jira setup failed' : 'Vendor onboarding project'}
      actions={[<SectionMessageAction key="go" onClick={start}>{state?.state === 'error' ? 'Try again' : 'Create the project'}</SectionMessageAction>]}
    >
      {state?.state === 'error' ? <Text>{state.error}</Text> : null}
      <Text>Creates a company-managed project "Vendor onboarding" whose Approve transition is blocked while a vendor has a possible sanctions match waiting for review or is blocked by a confirmed match. With the sample vendors loaded, it also adds ten onboarding requests, and moves the ones with a possible match to Sanctions review. It also creates an "Accounts payable" project for payment holds, unless Settings already names one. To use your own workflow instead, see Settings.</Text>
    </SectionMessage>
  );
}

function Onboarding({ onStarted }) {
  const [busy, setBusy] = useState(null);
  const go = async (name) => { setBusy(name); try { await call(name); onStarted(); } finally { setBusy(null); } };
  return (
    <EmptyState
      header="Load the sanctions lists"
      description="Sanctions Hold downloads the U.S. Treasury OFAC SDN List and Consolidated Sanctions List, the UK Sanctions List and the EU Consolidated Financial Sanctions List (about 30,000 entries for sanctioned companies and individuals, with over 48,000 aliases), then checks all three sources every hour and screens every vendor again after each update. The sample adds 197 vendors and holds back the newest designations so you can replay them as a list update."
      primaryAction={<Button appearance="primary" isLoading={busy === 'startDemo'} onClick={() => go('startDemo')}>Load the lists and the sample vendors</Button>}
      secondaryAction={<Button isLoading={busy === 'loadLists'} onClick={() => go('loadLists')}>Load the lists only</Button>}
    />
  );
}

function ListLine({ list, check, onUpdate }) {
  const [busy, setBusy] = useState(false);
  if (!list) return null;
  return (
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Text color="color.text.subtle">
        {`Lists updated ${[`OFAC ${list.published || 'unknown'}`, list.ukEntries ? `UK ${list.ukPublished || 'unknown'}` : null, list.euEntries ? `EU ${list.euPublished || 'unknown'}` : null].filter(Boolean).join(', ')} · ${list.entries.toLocaleString('en-US')} entries · loaded ${fmtTime(list.fetchedAt)} UTC${check?.at && check.at > list.fetchedAt ? ` · last checked ${fmtTime(check.at)} UTC` : ''}`}
      </Text>
      <Button appearance="subtle" isLoading={busy} onClick={async () => { setBusy(true); try { await call('updateNow'); onUpdate(); } finally { setBusy(false); } }}>Reload the lists</Button>
    </Inline>
  );
}

const EVENT_TEXT = {
  match_found: 'Possible match found',
  match_reopened: 'Dismissed match reopened (list entry changed)',
  match_dismissed: 'Marked not the same party',
  match_confirmed: 'Confirmed as the same party',
  approval_blocked: 'Approval blocked',
  approved: 'Approved',
  list_updated: 'Sanctions lists loaded',
  rescreen_all: 'All vendors screened',
  screened_by_tool: 'Screened by an agent',
  counterparty_added: 'Request opened by an agent',
  review_note_added: 'Review notes added by an agent',
  reviewers_changed: 'Reviewer group changed',
};
// A match the year-of-birth rule had cleared, open again because the rule was turned off or the year changed.
const byRuleOff = (e) => Boolean(e.detail?.ruleOff) || /^year-of-birth rule/.test(e.detail?.reason || '');
// Agent events name the surface that called the tool.
const VIA = { rovo: 'the Rovo agent', mcp: 'an MCP client' };
const eventLabel = (e) => {
  const via = VIA[e.detail?.via || e.detail?.source];
  if (via && e.type === 'screened_by_tool') return `Screened by ${via}`;
  if (via && e.type === 'counterparty_added') return `Request opened by ${via}`;
  if (via && e.type === 'review_note_added') return `Review notes by ${via}`;
  if (e.type === 'match_dismissed' && e.actor === 'rule:birth-year') return 'Cleared by the year-of-birth rule';
  // A match on an owner or director is about a person.
  if (Number(e.person) && e.type === 'match_dismissed') return 'Marked not the same person';
  if (Number(e.person) && e.type === 'match_confirmed') return 'Confirmed as the same person';
  if (e.type === 'match_reopened' && byRuleOff(e)) return 'Reopened: no longer cleared by the year-of-birth rule';
  if (e.type === 'match_reopened' && e.detail?.from) return 'Decision reopened for review';
  return EVENT_TEXT[e.type] || e.type;
};

// The list of a match in the activity table, so two matches for the same person read apart.
const LIST_SHORT = { SDN: 'OFAC SDN', CONS: 'OFAC Consolidated', UK: 'UK', EU: 'EU' };

function eventDetail(e) {
  const d = e.detail || {};
  if (e.type === 'list_updated') return d.initial ? `first import, lists updated ${listDates(d)}: ${Number(d.entries).toLocaleString('en-US')} entries${d.heldBack ? ' (newest SDN designations held back)' : ''}` : `lists updated ${listDates(d)}: ${d.added} added, ${d.removed} removed, ${d.changed} changed`;
  if (e.type === 'rescreen_all') return `${d.counterparties} vendors, ${d.newMatches} new possible matches`;
  // The reason of a rescreen ends with the account that changed Settings; the audit record keeps it, the table does not show it.
  const why = e.type === 'match_found' || byRuleOff(e) ? '' : String(d.reason || '').replace(/ by [0-9a-f]+:[0-9a-f-]+$/i, '');
  if (e.type.startsWith('match_')) return `${d.matchedName}, ${LIST_SHORT[String(e.entry_id).split(':')[0]] || 'list'} (${d.matchedOn ? d.matchedOn : score(d.score)})${why ? `: ${why}` : ''}`;
  if (e.type === 'approved') return `screening result: ${STATUS[d.status]?.label || d.status}; lists updated ${fmtVersion(d.listVersion)}`;
  if (e.type === 'screened_by_tool') return `${d.owners?.length ? `with ${d.owners.join(', ')}: ` : ''}${d.matches ? `${d.matches} ${d.matches === 1 ? 'match' : 'matches'}` : 'no match'}`;
  if (e.type === 'counterparty_added') return (d.owners || []).join(', ');
  if (e.type === 'approval_blocked') return `${STATUS[d.status]?.label || d.status}; ${d.matches} open ${d.matches === 1 ? 'match' : 'matches'}`;
  return '';
}

function Overview({ data, reload, goReview }) {
  const [busy, setBusy] = useState(false);
  const c = data.counts;
  // Hidden while an import runs: the replay is already under way.
  const held = data.list?.holdBackFrom && !['running', 'queued'].includes(data.jobs?.import?.state);
  const replay = async () => { setBusy(true); try { await call('replayDesignations'); reload(); } finally { setBusy(false); } };
  return (
    <Stack space="space.300">
      <Inline space="space.200" shouldWrap>
        <Stat label="Vendors waiting for review" value={c.review} />
        <Stat label="Blocked" value={c.blocked} />
        <Stat label="Cleared after review" value={c.cleared} />
        <Stat label="No match" value={c.clear} />
        <Stat label="Approved vendors now in review" value={c.approvedInReview} />
      </Inline>
      {held ? (
        <SectionMessage appearance="information" title="Sample: the newest designations are held back" actions={[<SectionMessageAction key="r" onClick={replay}>{busy ? 'Starting…' : 'Replay them as a list update'}</SectionMessageAction>]}>
          <Text>{`The sample started from the list updated ${data.list.published} without its newest designations (SDN entries ${held} and later). Replaying them loads the full list as an update and screens every vendor again, including vendors approved before those designations.`}</Text>
        </SectionMessage>
      ) : null}
      {!data.onboarding ? <JiraSetup setup={data.setup} onDone={reload} /> : (
        <Inline space="space.100" alignBlock="baseline">
          <Text>Onboarding project:</Text>
          <Link href={`/browse/${data.onboarding.projectKey}`}>{`Vendor onboarding (${data.onboarding.projectKey})`}</Link>
          <Text color="color.text.subtle">New work items are screened when they are created, and Approve checks the result.</Text>
        </Inline>
      )}
      {data.approvedMatched.length ? (
        <Stack space="space.100">
          <Heading size="small">Approved vendors with a new possible match</Heading>
          <DynamicTable
            head={{ cells: [{ key: 'v', content: 'Vendor' }, { key: 'w', content: 'Work item' }, { key: 'a', content: 'Approved' }, { key: 'm', content: 'Possible match' }, { key: 's', content: 'Score' }, { key: 'f', content: 'Found' }] }}
            rows={data.approvedMatched.map((h) => ({
              key: `${h.counterpartyId}-${h.entryId}`,
              cells: [
                { key: 'v', content: h.counterparty.name },
                { key: 'w', content: <IssueLink k={h.counterparty.issueKey} /> },
                { key: 'a', content: fmtDate(h.counterparty.approvedAt) },
                { key: 'm', content: `${matchedText(h)}; ${h.entry?.programs || listName(h.entry?.list)}` },
                { key: 's', content: score(h.score) },
                { key: 'f', content: fmtDate(h.foundAt) },
              ],
            }))}
          />
          <Inline><Button onClick={goReview}>Open the review queue</Button></Inline>
        </Stack>
      ) : null}
      <Heading size="small">Recent activity</Heading>
      {data.recent.length ? (
        <DynamicTable
          head={{ cells: [{ key: 't', content: 'Time (UTC)', width: 15 }, { key: 'e', content: 'Event', width: 25 }, { key: 'v', content: 'Vendor', width: 25 }, { key: 'd', content: 'Detail', width: 35 }] }}
          rows={data.recent.map((e, i) => ({
            key: `${e.at}-${i}`,
            cells: [
              { key: 't', content: fmtTime(e.at) },
              { key: 'e', content: eventLabel(e) },
              { key: 'v', content: e.issue_key ? <Inline space="space.050"><Text>{e.name || ''}</Text><IssueLink k={e.issue_key} /></Inline> : (e.name || e.detail?.name || '') },
              { key: 'd', content: eventDetail(e) },
            ],
          }))}
        />
      ) : <Text color="color.text.subtle">Nothing yet.</Text>}
    </Stack>
  );
}

function ReviewModal({ hit, onClose }) {
  return (
    <Modal onClose={() => onClose(false)} width="large">
      <ModalHeader><ModalTitle>{`${hit.counterparty.name}: ${hit.reviewedBy === 'rule:birth-year' && hit.status === 'dismissed' ? 'match cleared by the year-of-birth rule' : 'possible match'}`}</ModalTitle></ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Inline space="space.100" alignBlock="center">
            <Text>{`Vendor country: ${countryName(hit.counterparty.country) || 'not given'}`}</Text>
            {hit.counterparty.issueKey ? <IssueLink k={hit.counterparty.issueKey} /> : null}
            {hit.counterparty.approvedAt ? <Lozenge appearance="inprogress">{`Approved ${fmtDate(hit.counterparty.approvedAt)}`}</Lozenge> : null}
          </Inline>
          <MatchEvidence hit={hit} cp={hit.counterparty} />
          <ReviewedNote hit={hit} />
          <ReviewForm hit={hit} cp={hit.counterparty} onDone={() => onClose(true)} />
        </Stack>
      </ModalBody>
      <ModalFooter><Button onClick={() => onClose(false)}>Close</Button></ModalFooter>
    </Modal>
  );
}

// Keeps the queue's order but puts each vendor's possible matches next to each other.
const byVendor = (rows) => {
  const first = new Map();
  rows.forEach((h, i) => { if (!first.has(h.counterpartyId)) first.set(h.counterpartyId, i); });
  return rows.map((h, i) => [h, i]).sort((a, b) => first.get(a[0].counterpartyId) - first.get(b[0].counterpartyId) || a[1] - b[1]).map(([h]) => h);
};

function ReviewQueue({ onChange, stamp }) {
  const { data, loading, error, reload } = useLoad('reviewQueue', {}, [stamp]);
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Spinner label="Loading the review queue" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  const cleared = data.ruleCleared || [];
  if (!data.rows.length && !cleared.length) return <EmptyState header="No possible matches waiting for review" description="Possible matches appear here when a vendor is added or edited, and when a list update matches a vendor you already have." />;
  return (
    <Stack space="space.200">
      {data.rows.length ? <><Text color="color.text.subtle">{`${data.rows.length} possible ${data.rows.length === 1 ? 'match' : 'matches'} for ${new Set(data.rows.map((h) => h.counterpartyId)).size} ${new Set(data.rows.map((h) => h.counterpartyId)).size === 1 ? 'vendor' : 'vendors'} waiting for review. Approval stays blocked until a reviewer decides each one.`}</Text>
      <DynamicTable
        head={{ cells: [{ key: 'v', content: 'Vendor' }, { key: 'q', content: 'Found by' }, { key: 'm', content: 'List entry' }, { key: 'c', content: 'Vendor and list entry' }, { key: 's', content: 'Score' }, { key: 'f', content: 'Found' }, { key: 'x', content: '' }] }}
        rows={byVendor(data.rows).map((h, i, rows) => ({
          key: `${h.counterpartyId}-${h.entryId}`,
          cells: [
            // A vendor with several possible matches is named in full on its first row; the rows after it say it is the same vendor.
            { key: 'v', content: i && rows[i - 1].counterpartyId === h.counterpartyId ? <Text color="color.text.subtle">{`Same vendor${h.counterparty.issueKey ? ` (${h.counterparty.issueKey})` : ''}`}</Text> : <Stack space="space.050"><Text>{h.counterparty.name}</Text><Inline space="space.050">{h.counterparty.issueKey ? <IssueLink k={h.counterparty.issueKey} /> : null}{h.counterparty.approvedAt ? <Lozenge appearance="inprogress">{`Was approved ${fmtDate(h.counterparty.approvedAt)}`}</Lozenge> : null}</Inline></Stack> },
            { key: 'q', content: h.matchedOn ? 'Registration number' : h.queriedName === h.counterparty.name ? 'Company name' : `${ownerOfHit(h, h.counterparty)?.role === 'director' ? 'Director' : 'Owner'}: ${h.queriedName}` },
            { key: 'm', content: <Stack space="space.050"><Text>{matchedText(h)}</Text><Text color="color.text.subtle">{`${listName(h.entry?.list)} · ${h.entry?.programs || ''}`}</Text></Stack> },
            { key: 'c', content: placesOfHit(h, h.counterparty) },
            { key: 's', content: score(h.score) },
            { key: 'f', content: fmtDate(h.foundAt) },
            { key: 'x', content: <Button onClick={() => setOpen(h)}>Review</Button> },
          ],
        }))}
      /></> : <Text>No possible matches waiting for review.</Text>}
      {cleared.length ? (
        <Stack space="space.100">
          <Heading size="small">Cleared by the year-of-birth rule</Heading>
          <Text color="color.text.subtle">The owner's or director's year of birth is more than a year from every date of birth on the list entry. Open a match to confirm it as the same person if the year of birth on the vendor record is wrong.</Text>
          <DynamicTable
            head={{ cells: [{ key: 'v', content: 'Vendor' }, { key: 'q', content: 'Screened name' }, { key: 'm', content: 'List entry' }, { key: 'y', content: 'Years of birth' }, { key: 'd', content: 'Cleared' }, { key: 'x', content: '' }] }}
            rows={cleared.map((h) => ({
              key: `rule-${h.counterpartyId}-${h.entryId}`,
              cells: [
                { key: 'v', content: <Stack space="space.050"><Text>{h.counterparty.name}</Text>{h.counterparty.issueKey ? <IssueLink k={h.counterparty.issueKey} /> : null}</Stack> },
                { key: 'q', content: h.queriedName },
                { key: 'm', content: <Stack space="space.050"><Text>{matchedText(h)}</Text><Text color="color.text.subtle">{listName(h.entry?.list)}</Text></Stack> },
                { key: 'y', content: h.reason || '' },
                { key: 'd', content: fmtDate(h.reviewedAt) },
                { key: 'x', content: <Button onClick={() => setOpen(h)}>Open</Button> },
              ],
            }))}
          />
        </Stack>
      ) : null}
      <ModalTransition>{open ? <ReviewModal hit={open} onClose={(changed) => { setOpen(null); if (changed) { reload(); onChange(); } }} /> : null}</ModalTransition>
    </Stack>
  );
}

function VendorForm({ initial = {}, submitLabel, onSubmit }) {
  const [name, setName] = useState(initial.name || '');
  const [country, setCountry] = useState(initial.country || '');
  const [owners, setOwners] = useState((initial.owners || []).join('; '));
  const [address, setAddress] = useState(initial.address || '');
  const [registrationNumber, setRegistrationNumber] = useState(initial.registrationNumber || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await onSubmit({ name, country, address, registrationNumber, owners: owners.split(';').map((s) => s.trim()).filter(Boolean) }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Stack space="space.100">
      <Inline space="space.150" alignBlock="end" shouldWrap>
        <Stack space="space.050"><Label labelFor="vname">Legal name</Label><Box xcss={narrow}><Textfield id="vname" defaultValue={name} onChange={(e) => setName(e.target.value)} /></Box></Stack>
        <Stack space="space.050"><Label labelFor="vcountry">Country (2 letters)</Label><Box xcss={xcss({ width: '120px' })}><Textfield id="vcountry" defaultValue={country} onChange={(e) => setCountry(e.target.value)} /></Box></Stack>
        <Stack space="space.050"><Label labelFor="vaddress">Registered address</Label><Box xcss={narrow}><Textfield id="vaddress" defaultValue={address} onChange={(e) => setAddress(e.target.value)} /></Box></Stack>
        <Stack space="space.050"><Label labelFor="vreg">Registration or license number</Label><Box xcss={xcss({ width: '220px' })}><Textfield id="vreg" defaultValue={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} /></Box></Stack>
        <Stack space="space.050"><Label labelFor="vowners">Owners with their share, and directors, separated by ;</Label><Box xcss={narrow}><Textfield id="vowners" placeholder="Ali Kalhor 60%; Sara Haddad director" defaultValue={owners} onChange={(e) => setOwners(e.target.value)} /></Box></Stack>
        <Button appearance="primary" isLoading={busy} onClick={submit}>{submitLabel}</Button>
      </Inline>
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
    </Stack>
  );
}

function History({ events }) {
  if (!events.length) return null;
  return (
    <DynamicTable
      head={{ cells: [{ key: 't', content: 'Time (UTC)' }, { key: 'e', content: 'Event' }, { key: 'd', content: 'Detail' }] }}
      rows={events.slice(0, 15).map((e, i) => ({ key: `${e.at}-${i}`, cells: [{ key: 't', content: fmtTime(e.at) }, { key: 'e', content: EVENT_TEXT[e.type] ? eventLabel(e) : e.type.replace(/_/g, ' ') }, { key: 'd', content: eventDetail(e) }] }))}
    />
  );
}

function VendorModal({ id, onClose }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const load = () => call('getCounterparty', { id }).then((r) => setView(r.view), (e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cp = view?.counterparty;
  return (
    <Modal onClose={() => onClose(changed)} width="x-large">
      <ModalHeader><ModalTitle>{cp ? cp.name : 'Vendor'}</ModalTitle></ModalHeader>
      <ModalBody>
        {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
        {!cp ? <Spinner label="Loading" /> : (
          <Stack space="space.200">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <StatusLozenge status={cp.status} />
              <Text>{`${countryName(cp.country) || 'no country'} · ${cp.owners.length ? cp.owners.join(', ') : 'no owners given'}`}</Text>
              {cp.issue_key ? <IssueLink k={cp.issue_key} /> : null}
              {cp.approved_at ? <Lozenge appearance="inprogress">{`Approved ${fmtDate(cp.approved_at)}`}</Lozenge> : null}
            </Inline>
            <Text color="color.text.subtle">{cp.screened_at ? `Last screened ${fmtTime(cp.screened_at)} UTC against the lists updated ${fmtVersion(cp.screened_version)}.` : 'Not screened yet.'}</Text>
            <OwnershipNote view={view} onDone={() => { setChanged(true); load(); }} />
            {view.hits.map((h) => (
              <Stack key={h.entryId} space="space.100">
                <Inline space="space.100" alignBlock="center"><HitLozenge status={h.status} person={h.queriedName !== cp.name} reviewedBy={h.reviewedBy} />{!h.active && h.status !== 'confirmed' ? <Text color="color.text.subtle">no longer matches</Text> : null}</Inline>
                <MatchEvidence hit={h} cp={cp} />
                <ReviewedNote hit={h} />
                {h.status === 'pending' && h.active ? <ReviewForm hit={h} cp={cp} onDone={() => { setChanged(true); load(); }} /> : null}
              </Stack>
            ))}
            <Heading size="xsmall">Edit and screen again</Heading>
            <VendorForm initial={cp} submitLabel="Save and screen" onSubmit={async (v) => { const r = await call('editCounterparty', { id, ...v }); setView(r.view); setChanged(true); }} />
            <Heading size="xsmall">History</Heading>
            <History events={view.events} />
          </Stack>
        )}
      </ModalBody>
      <ModalFooter><Button onClick={() => onClose(changed)}>Close</Button></ModalFooter>
    </Modal>
  );
}

const STATUS_OPTIONS = [
  { label: 'Waiting for review', value: 'review' }, { label: 'Blocked', value: 'blocked' },
  { label: 'Cleared after review', value: 'cleared' }, { label: 'No match', value: 'clear' }, { label: 'Not screened', value: 'unscreened' },
];

function Vendors({ onChange, stamp }) {
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const list = useLoad('listCounterparties', { status, search: term, limit: 500 }, [status, term, stamp]);
  const upload = async (files) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const r = await call('importCsv', { data: f.data });
      setMsg({ appearance: 'success', text: `Imported ${r.imported} vendors${r.queued ? '; screening runs in the background' : ' and screened them'}.` });
      list.reload(); onChange();
    } catch (e) { setMsg({ appearance: 'error', text: e.message }); }
  };
  return (
    <Stack space="space.300">
      <Text color="color.text.subtle">Every vendor Sanctions Hold screens: from onboarding work items, the Rovo agent, MCP clients and CSV imports. All of them are screened again after each list update.</Text>
      <Heading size="small">Import the vendors you already work with</Heading>
      <Text color="color.text.subtle">CSV columns: name, country (2 letters), owners and directors separated by ; (for example "Ali Kalhor 60%; Sara Haddad director"), plus optional registered address, registration or license number, and approval date (YYYY-MM-DD). Imported vendors are screened now and after every list update, and a possible match opens a work item in the onboarding project.</Text>
      <Box xcss={narrow}><FilePicker label="Vendor CSV" onChange={upload} /></Box>
      {msg ? <SectionMessage appearance={msg.appearance}><Text>{msg.text}</Text></SectionMessage> : null}
      <Heading size="small">All vendors</Heading>
      <Inline space="space.150" alignBlock="end" shouldWrap>
        <Stack space="space.050"><Label labelFor="search">Search name, owner or work item</Label><Box xcss={narrow}><Textfield id="search" onChange={(e) => setSearch(e.target.value)} /></Box></Stack>
        <Button onClick={() => setTerm(search)}>Search</Button>
        <Stack space="space.050"><Label labelFor="status">Status</Label><Box xcss={xcss({ width: '220px' })}><Select inputId="status" isClearable placeholder="All" options={STATUS_OPTIONS} onChange={(o) => setStatus(o?.value || null)} /></Box></Stack>
      </Inline>
      {list.loading && !list.data ? <Spinner label="Loading vendors" /> : list.error ? <SectionMessage appearance="error"><Text>{list.error}</Text></SectionMessage> : (
        <Stack space="space.100">
          <Text color="color.text.subtle">{`${list.data.total} vendors${list.data.total > list.data.rows.length ? `, first ${list.data.rows.length} shown` : ''}.`}</Text>
          <DynamicTable
            head={{ cells: [{ key: 'n', content: 'Vendor' }, { key: 'c', content: 'Country' }, { key: 'o', content: 'Owners' }, { key: 's', content: 'Status' }, { key: 'w', content: 'Work item' }, { key: 'a', content: 'Approved' }, { key: 'x', content: '' }] }}
            rows={list.data.rows.map((v) => ({
              key: v.id,
              cells: [
                { key: 'n', content: v.name },
                { key: 'c', content: v.country || '' },
                { key: 'o', content: v.owners.join(', ') },
                { key: 's', content: <StatusLozenge status={v.status} /> },
                { key: 'w', content: <IssueLink k={v.issue_key} /> },
                { key: 'a', content: fmtDate(v.approved_at) },
                { key: 'x', content: <Button appearance="subtle" onClick={() => setOpen(v.id)}>Open</Button> },
              ],
            }))}
            rowsPerPage={25}
          />
        </Stack>
      )}
      <Heading size="small">Add a vendor</Heading>
      <VendorForm submitLabel="Add and screen" onSubmit={async (v) => { const r = await call('addCounterparty', v); setOpen(r.view.counterparty.id); list.reload(); onChange(); }} />
      <ModalTransition>{open ? <VendorModal id={open} onClose={(changed) => { setOpen(null); if (changed) { list.reload(); onChange(); } }} /> : null}</ModalTransition>
    </Stack>
  );
}

const CHANGE = { added: { label: 'Added', appearance: 'removed' }, removed: { label: 'Removed', appearance: 'success' }, changed: { label: 'Changed', appearance: 'moved' } };

function ListUpdates({ stamp }) {
  const { data, loading, error } = useLoad('listUpdates', {}, [stamp]);
  if (loading && !data) return <Spinner label="Loading list updates" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  const latest = data.versions.find((v) => v.added || v.removed || v.changed);
  const changes = latest ? data.changes.filter((c) => c.version_id === latest.id) : [];
  const matched = latest ? data.matched.filter((m) => m.found_version === latest.id) : [];
  return (
    <Stack space="space.300">
      <Text color="color.text.subtle">Every hour the app checks the OFAC, UK and EU list files for a new version and imports a changed file. Entries are compared by their list ID, so added, removed and changed names, aliases, programs or regimes and countries are recorded.</Text>
      <DynamicTable
        head={{ cells: [{ key: 'p', content: 'Lists updated' }, { key: 'l', content: 'Loaded (UTC)' }, { key: 'e', content: 'Entries' }, { key: 'a', content: 'Added' }, { key: 'r', content: 'Removed' }, { key: 'c', content: 'Changed' }, { key: 'n', content: 'Note' }] }}
        // Non-breaking hyphens keep each list date on one line in the narrow first column.
        rows={data.versions.map((v) => ({ key: v.id, cells: [
          { key: 'p', content: (fmtVersion(v.id, { held: false }) || v.published || '').replace(/-/g, '\u2011') }, { key: 'l', content: fmtTime(v.fetched_at) }, { key: 'e', content: Number(v.entries).toLocaleString('en-US') },
          { key: 'a', content: String(v.added) }, { key: 'r', content: String(v.removed) }, { key: 'c', content: String(v.changed) }, { key: 'n', content: v.note || '' },
        ] }))}
      />
      {latest ? (
        <Stack space="space.150">
          <Heading size="small">{`Vendors matched by the update loaded ${fmtTime(latest.fetched_at)} UTC`}</Heading>
          {matched.length ? (
            <DynamicTable
              head={{ cells: [{ key: 'v', content: 'Vendor' }, { key: 'w', content: 'Work item' }, { key: 'a', content: 'Approved' }, { key: 'm', content: 'List entry' }, { key: 's', content: 'Score' }, { key: 'h', content: 'Review' }] }}
              rows={matched.map((m) => ({ key: `${m.id}-${m.entry_id}`, cells: [
                { key: 'v', content: m.name }, { key: 'w', content: <IssueLink k={m.issue_key} /> }, { key: 'a', content: fmtDate(m.approved_at) },
                { key: 'm', content: m.matched_name }, { key: 's', content: score(m.score) }, { key: 'h', content: <HitLozenge status={m.status} reviewedBy={m.reviewed_by} /> },
              ] }))}
            />
          ) : <Text>No vendor matches the changed entries.</Text>}
          <Heading size="small">Changed entries</Heading>
          <DynamicTable
            head={{ cells: [{ key: 't', content: 'Change' }, { key: 'n', content: 'Name' }, { key: 'k', content: 'Type' }, { key: 'p', content: 'Program or regime' }, { key: 'c', content: 'Countries' }] }}
            rows={changes.map((c) => ({ key: `${c.entry_id}-${c.change_type}`, cells: [
              { key: 't', content: <Lozenge appearance={CHANGE[c.change_type]?.appearance}>{CHANGE[c.change_type]?.label || c.change_type}</Lozenge> },
              { key: 'n', content: c.name || c.entry_id }, { key: 'k', content: c.kind || '' }, { key: 'p', content: c.programs || '' }, { key: 'c', content: c.countries || '' },
            ] }))}
            rowsPerPage={20}
          />
        </Stack>
      ) : <Text>No update since the first import.</Text>}
      <Text color="color.text.subtle" size="small">Sources: OFAC Sanctions List Service; UK Sanctions List, public sector information licensed under the Open Government Licence v3.0; EU Financial Sanctions Files, reused from the European Commission (only the texts published in the Official Journal of the EU are authentic).</Text>
    </Stack>
  );
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const num = (n) => Number(n).toLocaleString('en-US');
const KIND = {
  exact: 'Name as listed', alias: 'Alias', typo: 'One-letter typo', transliteration: 'Transliteration (Mohammad / Muhammad, Kh / H)',
  word_order: 'Word order (first name first)', legal_suffix: 'Different legal suffix (LLC, Ltd, Co.)',
  given_and_surname: 'Person by one given name and surname (middle names left out)',
};

// One row per kind of query, with a column pair (found of queries, rate) for each run.
function AccuracyTable({ runs }) {
  const found = (n, f) => `${num(f)} of ${num(n)}`;
  const cells = (k, pick, bold = false) => runs.flatMap(({ key, r }) => {
    const v = pick(r);
    if (!v) return [{ key: `${key}-f`, content: '' }, { key: `${key}-r`, content: '' }];
    const rate = pct(v.f / v.n);
    return [{ key: `${key}-f`, content: found(v.n, v.f) }, { key: `${key}-r`, content: bold ? <Strong>{rate}</Strong> : rate }];
  });
  const kinds = Object.keys(KIND).filter((k) => runs.some(({ r }) => r.positives[k]));
  return (
    <DynamicTable
      head={{ cells: [{ key: 'k', content: 'Query' }, ...runs.flatMap(({ key, label }) => [{ key: `${key}-f`, content: label }, { key: `${key}-r`, content: 'Rate' }])] }}
      rows={[
        ...kinds.map((k) => ({ key: k, cells: [{ key: 'k', content: KIND[k] }, ...cells(k, (r) => r.positives[k] && { n: r.positives[k].n, f: r.positives[k].found })] })),
        { key: 'all', cells: [{ key: 'k', content: <Strong>All list-name queries (recall)</Strong> }, ...cells('all', (r) => ({ n: r.total.n, f: r.total.found }), true)] },
        { key: 'neg', cells: [{ key: 'k', content: <Strong>{`Real company names not on the lists, flagged (false positives${runs.length > 1 ? '; the same names in both runs' : ''})`}</Strong> }, ...cells('neg', (r) => ({ n: r.negatives.n, f: r.negatives.falsePositives }), true)] },
        { key: 'ppl', cells: [{ key: 'k', content: <Strong>{`Real person names not on the lists, flagged (false positives${runs.length > 1 ? '; the same names in both runs' : ''})`}</Strong> }, ...cells('ppl', (r) => r.people && { n: r.people.n, f: r.people.falsePositives }, true)] },
        ...(runs.some(({ r }) => r.peopleAfterBirthYearRule) ? [{ key: 'ppl-year', cells: [{ key: 'k', content: 'The same people, with the year-of-birth rule on (see Settings)' }, ...cells('ppl-year', (r) => r.people && r.peopleAfterBirthYearRule && { n: r.people.n, f: r.peopleAfterBirthYearRule.left })] }] : []),
      ]}
    />
  );
}

// Flagged names per country, so that a high rate in one country is not hidden in the average.
const countryCounts = (by) => Object.entries(by || {}).filter(([, c]) => c.flagged).sort((a, b) => b[1].flagged - a[1].flagged || a[0].localeCompare(b[0]))
  .map(([k, c]) => `${k} ${c.flagged} of ${c.n}`).join(', ');
function ByCountry({ r }) {
  const companies = countryCounts(r.negatives?.byCountry);
  const people = countryCounts(r.people?.byCountry);
  const left = r.peopleAfterBirthYearRule?.byCountry || null;
  const rule = left ? Object.entries(left).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n} of ${r.people.byCountry[k]?.n ?? '?'}`).join(', ') : '';
  return (
    <>
      {companies ? <Text color="color.text.subtle">{`Flagged company names by country: ${companies}.`}</Text> : null}
      {people ? <Text color="color.text.subtle">{`Flagged person names by country: ${people}.${left ? ` With the year-of-birth rule on: ${rule || 'none'}.` : ''}`}</Text> : null}
    </>
  );
}

function Accuracy({ onStarted, finishedAt }) {
  const { data, loading, error } = useLoad('accuracy', {}, [finishedAt]);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState(false);
  if (loading && !data) return <Spinner label="Loading" />;
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  const { offline, last } = data;
  const dates = (r) => [`OFAC ${r.listPublished}`, r.ukPublished ? `UK ${r.ukPublished}` : null, r.euPublished ? `EU ${r.euPublished}` : null].filter(Boolean).join(', ');
  const shown = last || offline;
  return (
    <Stack space="space.200">
      <Text>{`How the test works: 1,500 list entries are drawn at random and each is searched for by its listed name, an alias and five kinds of name variant. Recall is the share of those searches that find the entry. The false positive rates are the shares of ${num(offline.negatives.n)} real company names and ${num(offline.people?.n || 0)} real person names from 17 countries and territories, not on the lists, that are flagged for review.`}</Text>
      <AccuracyTable runs={[...(last ? [{ key: 'site', label: 'On this site', r: last }] : []), { key: 'off', label: 'Held-out sample', r: offline }]} />
      <Text color="color.text.subtle">{`${last ? `On this site: run ${fmtTime(last.at)} UTC at threshold ${last.threshold} on the lists updated ${dates(last)}, ${num(last.queries)} searches.` : 'Not run on this site yet.'} Held-out sample: measured offline ${offline.measuredAt} at threshold ${offline.threshold} on the lists updated ${offline.listPublished}, with names that were not used to tune the matcher.`}</Text>
      <Text color="color.text.subtle">Registration numbers (measured offline 2026-11-26): all 14,034 numbers of six characters or more on company and organisation entries find their entry when searched with the country given for each. None of 10,809 GLEIF companies searched by registration number (1,846 in Russia, 8,963 in 16 other countries and territories) matched another company's entry.</Text>
      <Text color="color.text.subtle">Year-of-birth rule (measured offline 2026-11-26): across person entries that share a primary name on two lists, checking one entry's year of birth against the other keeps 6,828 of 6,925 checks in review (98.6%).</Text>
      <Inline space="space.100"><Button isLoading={busy} onClick={async () => { setBusy(true); try { await call('runAccuracy'); onStarted(); } finally { setBusy(false); } }}>{last ? 'Run again on this site' : 'Run the test on this site'}</Button>
        <Button appearance="subtle" onClick={() => setMethod(!method)}>{method ? 'Hide sampling details and flagged names' : 'Sampling details and flagged names'}</Button></Inline>
      {method ? (
        <Stack space="space.100">
          <Text color="color.text.subtle">{`${last ? `On this site, the list entries are a random draw of their own from the lists as loaded, the real names are the same, and a search took ${last.avgMs.toFixed(1)} ms on average against ${num(last.listNames)} list names. ` : ''}${offline.note} Company names: ${data.negativesSource}. Person names: ${data.peopleSource}.`}</Text>
          <ByCountry r={shown} />
          {last?.fpSamples?.length ? <Text color="color.text.subtle">{`Flagged company names: ${last.fpSamples.slice(0, 6).map((f) => `${f.name} (${f.country}) ~ ${f.matched}`).join('; ')}.`}</Text> : null}
          {last?.peopleSamples?.length ? <Text color="color.text.subtle">{`Flagged person names: ${last.peopleSamples.slice(0, 6).map((f) => `${f.name} (${f.country}) ~ ${f.matched}`).join('; ')}.`}</Text> : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

const OWNER_RULES = [
  { value: 'fifty', label: 'OFAC, UK and EU ownership rules (default)' },
  { value: 'any', label: 'Block on any confirmed listed owner or director' },
];
const THRESHOLDS = [
  { value: 0.88, label: '0.88: more possible matches (99.6% recall; 0.8% of companies, 2.0% of people flagged)' },
  { value: 0.9, label: '0.90 (99.6% recall; 0.7% of companies, 1.9% of people flagged)' },
  { value: 0.92, label: '0.92: default (99.5% recall; 0.3% of companies, 1.8% of people flagged)' },
  { value: 0.94, label: '0.94: fewer reviews (99.4% recall; 0.2% of companies, 1.6% of people flagged)' },
];

const BIRTH_YEAR = [
  { value: 'off', label: 'Off (default): a reviewer decides every possible match' },
  { value: 'on', label: 'On: clear matches whose year of birth is more than a year apart' },
];

function Settings({ onChange, onRemoved, stamp }) {
  const { data, loading, reload } = useLoad('getSettings', {}, [stamp]);
  const [msg, setMsg] = useState(null);
  const [audit, setAudit] = useState(null);
  const [busy, setBusy] = useState(null);
  const save = async (patch) => {
    try { await call('saveSettings', { threshold: data.policy.threshold, ownerRule: data.policy.ownerRule, birthYearRule: data.policy.birthYearRule, ...patch }); setMsg({ appearance: 'success', text: 'Saved. Every vendor is screened again with the new setting.' }); reload(); onChange(); } catch (e) { setMsg({ appearance: 'error', text: e.message }); }
  };
  const saveReviewers = async (groupId) => {
    try { await call('saveReviewers', { group: groupId ? { groupId } : null }); setMsg({ appearance: 'success', text: groupId ? 'Saved. Only members of that group decide possible matches.' : 'Saved. Anyone who can open the work item decides possible matches.' }); reload(); } catch (e) { setMsg({ appearance: 'error', text: e.message }); }
  };
  const savePaymentHolds = async (projectKey) => {
    try { await call('savePaymentHolds', { projectKey: projectKey || null }); setMsg({ appearance: 'success', text: projectKey ? 'Saved. An approved vendor with a new possible match gets a payment hold in that project.' : 'Saved. No payment holds are opened.' }); reload(); } catch (e) { setMsg({ appearance: 'error', text: e.message }); }
  };
  if (loading || !data) return <Spinner label="Loading settings" />;
  const noHolds = { label: 'No payment holds', value: '' };
  const holdOptions = [noHolds, ...data.available.filter((p) => p.key !== data.onboardingKey).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))];
  const anyone = { label: 'Anyone who can open the work item', value: '' };
  const groupOptions = [anyone, ...(data.groups || []).map((g) => ({ label: g.name, value: g.groupId }))];
  const current = THRESHOLDS.find((t) => t.value === data.policy.threshold) || { value: data.policy.threshold, label: String(data.policy.threshold) };
  const off = !data.admin;
  return (
    <Stack space="space.300">
      {off ? <Text color="color.text.subtle">Only Jira admins can change these settings.</Text> : null}
      <Stack space="space.100">
        <Heading size="small">Match threshold</Heading>
        <Text color="color.text.subtle">Names scoring at or above the threshold go to the review queue. The rates come from the accuracy test.</Text>
        <Box xcss={xcss({ width: '640px' })}><Select inputId="threshold" isDisabled={off} value={current} options={THRESHOLDS} onChange={(o) => o && save({ threshold: o.value, ownerRule: data.policy.ownerRule })} /></Box>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Listed owners and directors</Heading>
        <Text color="color.text.subtle">With the ownership rules, confirmed owners block the vendor under the rule of the list that names them: OFAC-listed or EU-listed owners holding 50% or more together, or one UK-listed owner holding more than 50%. A confirmed owner without a share also blocks. Otherwise, and for directors, a reviewer decides whether to proceed or block.</Text>
        <Box xcss={xcss({ width: '480px' })}><Select inputId="owner-rule" isDisabled={off} value={OWNER_RULES.find((r) => r.value === (data.policy.ownerRule || 'fifty'))} options={OWNER_RULES} onChange={(o) => o && save({ threshold: data.policy.threshold, ownerRule: o.value })} /></Box>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Year of birth</Heading>
        <Text color="color.text.subtle">With the rule on, a possible match for an owner or director is cleared when their year of birth is more than one year from every date of birth on the list entry. A range of years on the entry counts as every year in it, and a circa year as two years either side. The audit record and the work item note each match the rule cleared, and the match comes back for review if the year of birth or the list entry changes.</Text>
        <Box xcss={xcss({ width: '480px' })}><Select inputId="birth-year" isDisabled={off} value={BIRTH_YEAR.find((r) => r.value === (data.policy.birthYearRule ? 'on' : 'off'))} options={BIRTH_YEAR} onChange={(o) => o && save({ birthYearRule: o.value === 'on' })} /></Box>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Who decides possible matches</Heading>
        <Text color="color.text.subtle">With a Jira group chosen, only its members decide possible matches and listed minority owners or directors. Everyone else sees the evidence.</Text>
        <Box xcss={xcss({ width: '480px' })}><Select inputId="reviewers" isDisabled={off} value={data.reviewers ? { label: data.reviewers.name, value: data.reviewers.groupId } : anyone} options={groupOptions} onChange={(o) => o && saveReviewers(o.value)} /></Box>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Payment holds</Heading>
        <Text color="color.text.subtle">With a project chosen, when a list update, an import or a change in these settings finds a possible match for an approved vendor, the app also opens a work item "Hold payments to …" in that project, linked to the vendor's work item, so the payments team can hold payments until the match is decided. When the reviewer clears the vendor, the app comments that payments can resume and moves the hold to Done; when the vendor is blocked, it comments that payments stay on hold and leaves the hold open.</Text>
        <Box xcss={xcss({ width: '480px' })}><Select inputId="payment-holds" isDisabled={off} value={data.paymentHolds ? { label: `${data.paymentHolds.name} (${data.paymentHolds.key})`, value: data.paymentHolds.key } : noHolds} options={holdOptions} onChange={(o) => o && savePaymentHolds(o.value)} /></Box>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Projects screened automatically</Heading>
        <Text color="color.text.subtle">A work item created in these projects is screened under its summary, the vendor's legal name, with the country, owners and directors in its Vendor details field.</Text>
        <Box xcss={xcss({ width: '480px' })}>
          <Select inputId="projects" isMulti isDisabled={off} value={data.projects.map((p) => ({ label: p, value: p }))} options={data.available.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} onChange={(o) => save({ threshold: data.policy.threshold, ownerRule: data.policy.ownerRule, projects: (o || []).map((x) => x.value) })} />
        </Box>
        <Text color="color.text.subtle">To add the check to a workflow you already use: in a company-managed project, open the workflow, select the approval transition, add the validator "Vendor is cleared on the sanctions lists" and publish.</Text>
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Audit record</Heading>
        <Text color="color.text.subtle">Each screening, decision and blocked approval is kept with the list version it used, one row per event in the CSV.</Text>
        <Inline><Button isLoading={busy === 'audit'} onClick={async () => { setBusy('audit'); try { setAudit((await call('auditCsv', { days: 90 })).csv); } finally { setBusy(null); } }}>Build the CSV for the last 90 days</Button></Inline>
        {audit ? <CodeBlock language="text" shouldWrapLongLines text={audit} /> : null}
      </Stack>
      <Stack space="space.100">
        <Heading size="small">Sample data</Heading>
        <Inline><Button appearance="warning" isDisabled={off} onClick={async () => { try { await call('removeSample'); onRemoved(); } catch (e) { setMsg({ appearance: 'error', text: e.message }); } }}>Remove the sample vendors</Button></Inline>
      </Stack>
      {msg ? <SectionMessage appearance={msg.appearance}><Text>{msg.text}</Text></SectionMessage> : null}
    </Stack>
  );
}

function App() {
  const overview = useLoad('overview', {}, []);
  const [tab, setTab] = useState(0);
  // Right after an install the first calls also set up the app's tables and can time out; try again a few times.
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!overview.error || tries >= 3) return undefined;
    const t = setTimeout(() => { setTries((n) => n + 1); overview.reload(); }, 4000);
    return () => clearTimeout(t);
  }, [overview.error, tries]); // eslint-disable-line react-hooks/exhaustive-deps
  if ((overview.loading && !overview.data) || (overview.error && tries < 3)) return <Spinner label="Loading Sanctions Hold" />;
  if (overview.error) return <SectionMessage appearance="error" title="Sanctions Hold could not load" actions={[<SectionMessageAction key="retry" onClick={() => { setTries(0); overview.reload(); }}>Try again</SectionMessageAction>]}><Text>{overview.error}</Text></SectionMessage>;
  const d = overview.data;
  const busy = Object.values(d.jobs).some((j) => j && (j.state === 'running' || j.state === 'queued'));
  // Tabs stay mounted; this changes when a job or a decision changes what they show.
  const stamp = `${d.list?.version || ''}|${d.waiting}|${d.counts.total}|${d.jobs.rescreen?.finishedAt || ''}|${d.setup?.finishedAt || ''}`;
  return (
    <Stack space="space.300">
      <Text color="color.text.subtle">Sanctions screening for vendors and their owners against the OFAC, UK and EU lists. Jira holds a vendor's approval until a reviewer decides each possible match.</Text>
      <JobBanner jobs={d.jobs} onDone={overview.reload} />
      {!d.list && !busy ? <Onboarding onStarted={overview.reload} /> : null}
      {d.list ? (
        <>
          <ListLine list={d.list} check={d.check} onUpdate={overview.reload} />
          <Tabs id="main" selected={tab} onChange={setTab}>
            <TabList>
              <Tab>Overview</Tab>
              <Tab>{`Review queue (${d.waiting})`}</Tab>
              <Tab>Vendors</Tab>
              <Tab>List updates</Tab>
              <Tab>Accuracy</Tab>
              <Tab>Settings</Tab>
            </TabList>
            <TabPanel><Box xcss={pad}><Overview data={d} reload={overview.reload} goReview={() => setTab(1)} /></Box></TabPanel>
            <TabPanel><Box xcss={pad}><ReviewQueue onChange={overview.reload} stamp={stamp} /></Box></TabPanel>
            <TabPanel><Box xcss={pad}><Vendors onChange={overview.reload} stamp={stamp} /></Box></TabPanel>
            <TabPanel><Box xcss={pad}><ListUpdates stamp={stamp} /></Box></TabPanel>
            <TabPanel><Box xcss={pad}><Accuracy onStarted={overview.reload} finishedAt={d.jobs.accuracy?.finishedAt || null} /></Box></TabPanel>
            <TabPanel><Box xcss={pad}><Settings stamp={stamp} onChange={overview.reload} onRemoved={() => { setTab(0); overview.reload(); }} /></Box></TabPanel>
          </Tabs>
        </>
      ) : null}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
