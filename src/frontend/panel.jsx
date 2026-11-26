import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Button, Textfield, Label, Spinner, SectionMessage, Heading, useProductContext } from '@forge/react';
import { events } from '@forge/bridge';
import { call, StatusLozenge, HitLozenge, MatchEvidence, ReviewForm, ReviewedNote, OwnershipNote, ownerOfHit, fmtTime, fmtVersion, countryName, listDates, useReviewAccess } from './common.jsx';
import { formatOwner } from '../core/owners.js';

const STATUS_NOTE = {
  company: 'A reviewer confirmed a sanctions list match for this vendor. Approval is blocked.',
  'listed-person': 'A reviewer confirmed a listed owner or director. Approval is blocked.',
  pending: 'Approval is held until a reviewer decides each possible match below.',
  dismissed: 'Every possible match was reviewed and dismissed. The vendor can be approved.',
  none: 'No possible match on the OFAC, UK or EU sanctions lists. The vendor can be approved.',
};

function Panel() {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  // The same resource renders the sidebar (issueContext) and the wider panel opened from Apps (issuePanel).
  const compact = context?.moduleKey === 'sanctions-hold-context' || context?.extension?.type === 'jira:issueContext';
  const [data, setData] = useState(undefined);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const access = useReviewAccess();
  const load = () => call('issueView', { issueKey }).then((r) => {
    setData(r);
    const cp = r.view?.counterparty;
    setForm(cp ? { name: cp.name, country: cp.country || '', address: cp.address || '', registrationNumber: cp.registrationNumber || '', owners: cp.owners.join('; ') } : { name: r.suggestion?.name || '', country: r.suggestion?.country || '', address: '', registrationNumber: '', owners: (r.suggestion?.owners || []).join('; ') });
  }, (e) => setError(e.message));
  useEffect(() => { if (issueKey) load(); }, [issueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The sidebar and the wider panel are separate frames; a decision or edit in one reloads the other.
  useEffect(() => {
    if (!issueKey) return undefined;
    const sub = events.on('sanctions-hold-changed', (p) => { if (!p || p.issueKey === issueKey) load(); });
    return () => { sub.then((s) => s.unsubscribe()).catch(() => null); };
  }, [issueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); events.emit('sanctions-hold-changed', { issueKey }).catch(() => null); };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('issueSetVendor', { issueKey, name: form.name, country: form.country, address: form.address, registrationNumber: form.registrationNumber, owners: form.owners.split(';').map((s) => s.trim()).filter(Boolean) });
      setData((d) => ({ ...d, view: r.view }));
      setEditing(false);
      events.emit('sanctions-hold-changed', { issueKey }).catch(() => null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (data === undefined && !error) return <Spinner label="Loading sanctions screening" />;
  const view = data?.view;
  const cp = view?.counterparty;
  // Matches waiting for a decision first, then confirmed ones, then dismissed ones.
  const ORDER = { pending: 0, confirmed: 1, dismissed: 2 };
  const open = (view?.hits || []).filter((h) => h.status === 'confirmed' || h.active).sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3));
  const fields = form ? (
    <Stack space="space.100">
      <Stack space="space.050"><Label labelFor="pname">Vendor legal name</Label><Textfield id="pname" defaultValue={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="pcountry">Country (2 letters)</Label><Textfield id="pcountry" defaultValue={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="paddress">Registered address</Label><Textfield id="paddress" defaultValue={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="preg">Registration or license number</Label><Textfield id="preg" defaultValue={form.registrationNumber} onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="powners">Owners with their share, and directors, separated by ;</Label><Textfield id="powners" placeholder="Ali Kalhor 60% born 1963 nationality Iran; Sara Haddad director" defaultValue={form.owners} onChange={(e) => setForm({ ...form, owners: e.target.value })} /></Stack>
      <Inline><Button appearance="primary" isLoading={busy} onClick={save}>{cp ? 'Save and screen again' : 'Screen this vendor'}</Button></Inline>
    </Stack>
  ) : null;
  const byRule = (view?.hits || []).some((h) => h.active && h.status === 'dismissed' && h.reviewedBy === 'rule:birth-year');
  const note = view?.assessment?.reason === 'dismissed' && byRule
    ? 'Every possible match was dismissed by a reviewer or cleared by the year-of-birth rule. The vendor can be approved.'
    : STATUS_NOTE[view?.assessment?.reason];
  // Reviewers decide in the panel in the main column, which the app opens on each held work item.
  const pending = open.filter((h) => h.status === 'pending').length;
  const who = access && !access.allowed ? ` (members of the Jira group ${access.group})` : '';
  // A listed minority owner or director has its own note below, from OwnershipNote.
  const toDecide = pending ? `${pending} possible ${pending === 1 ? 'match' : 'matches'} to decide in the Sanctions Hold panel${who}.` : null;
  return (
    <Stack space="space.200">
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      {!data?.list ? <Text>The sanctions lists are not loaded yet. Open Sanctions Hold from the Apps menu to load them.</Text> : null}
      {cp ? (
        <Stack space="space.150">
          {/* In the narrow sidebar a long vendor name would squeeze the lozenge, so the name goes on its own line. */}
          {compact
            ? <Stack space="space.050"><Inline><StatusLozenge status={cp.status} /></Inline><Text weight="medium">{cp.name}</Text></Stack>
            : <Inline space="space.100" alignBlock="center" shouldWrap><StatusLozenge status={cp.status} /><Text weight="medium">{cp.name}</Text></Inline>}
          <Text color="color.text.subtle">{compact
            ? [countryName(cp.country) || 'No country', cp.registrationNumber ? `registration ${cp.registrationNumber}` : null, cp.ownerDetails.length ? cp.ownerDetails.map(formatOwner).join(', ') : 'no owners given'].filter(Boolean).join(' · ')
            : `${[countryName(cp.country) || 'No country', cp.address, cp.registrationNumber ? `registration ${cp.registrationNumber}` : null].filter(Boolean).join(', ')} · ${cp.ownerDetails.length ? cp.ownerDetails.map(formatOwner).join(', ') : 'no owners given'} · screened ${fmtTime(cp.screened_at)} UTC against the lists updated ${cp.screened_version ? fmtVersion(cp.screened_version, { held: false }) : listDates(data.list)}`}</Text>
          {/* The sidebar is a summary: the status, the vendor's details and one line on what is left to decide. The panel explains. */}
          {compact ? (toDecide ? <Text>{toDecide}</Text> : null) : note ? <Text>{note}</Text> : null}
          <OwnershipNote view={view} onDone={changed} compact={compact} />
          {/* Keyed by the order and status of the matches, so a decision that reorders them draws the list afresh. */}
          <Stack key={open.map((h) => `${h.entryId}:${h.status}`).join('|')} space="space.150">
          {open.map((h) => {
            const owner = ownerOfHit(h, cp);
            return (
              <Stack key={h.entryId} space="space.100">
                {compact ? null : <Heading size="xsmall">{`${h.status === 'confirmed' ? 'Confirmed match' : h.status === 'dismissed' ? (h.reviewedBy === 'rule:birth-year' ? 'Cleared match' : 'Dismissed match') : 'Possible match'} for ${owner ? `${owner.role === 'director' ? 'director' : 'owner'} ${owner.name}` : h.matchedOn ? 'the registration number' : 'the company name'}`}</Heading>}
                {h.status !== 'pending' && (compact || h.reviewedBy !== 'rule:birth-year') ? <Inline><HitLozenge status={h.status} reviewedBy={h.reviewedBy} person={Boolean(owner)} /></Inline> : null}
                <MatchEvidence hit={h} cp={cp} compact={compact} />
                {compact ? null : <ReviewedNote hit={h} onReopen={changed} />}
                {h.status === 'pending' && !compact ? <ReviewForm hit={h} cp={cp} onDone={changed} /> : null}
              </Stack>
            );
          })}
          </Stack>
          {editing ? fields : <Inline><Button appearance="subtle" onClick={() => setEditing(true)}>Edit vendor name and details</Button></Inline>}
        </Stack>
      ) : (
        <Stack space="space.100">
          <Text>Not screened yet. Check the vendor's legal name, country and owners, then screen it against the OFAC, UK and EU sanctions lists.</Text>
          {fields}
        </Stack>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><Panel /></React.StrictMode>);
