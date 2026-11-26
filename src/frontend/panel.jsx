import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Button, Textfield, Label, Spinner, SectionMessage, Heading, useProductContext } from '@forge/react';
import { call, StatusLozenge, HitLozenge, MatchEvidence, ReviewForm, ReviewedNote, OwnershipNote, ownerOfHit, fmtTime, fmtVersion, countryName, listDates } from './common.jsx';
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
  const [data, setData] = useState(undefined);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => call('issueView', { issueKey }).then((r) => {
    setData(r);
    const cp = r.view?.counterparty;
    setForm(cp ? { name: cp.name, country: cp.country || '', owners: cp.owners.join('; ') } : { name: r.suggestion?.name || '', country: r.suggestion?.country || '', owners: (r.suggestion?.owners || []).join('; ') });
  }, (e) => setError(e.message));
  useEffect(() => { if (issueKey) load(); }, [issueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call('issueSetVendor', { issueKey, name: form.name, country: form.country, owners: form.owners.split(';').map((s) => s.trim()).filter(Boolean) });
      setData((d) => ({ ...d, view: r.view }));
      setEditing(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (data === undefined && !error) return <Spinner label="Loading sanctions screening" />;
  const view = data?.view;
  const cp = view?.counterparty;
  const open = (view?.hits || []).filter((h) => h.status === 'confirmed' || h.active);
  const fields = form ? (
    <Stack space="space.100">
      <Stack space="space.050"><Label labelFor="pname">Vendor legal name</Label><Textfield id="pname" defaultValue={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="pcountry">Country (2 letters)</Label><Textfield id="pcountry" defaultValue={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Stack>
      <Stack space="space.050"><Label labelFor="powners">Owners with their share, and directors, separated by ;</Label><Textfield id="powners" placeholder="Ali Kalhor 60%; Sara Haddad director" defaultValue={form.owners} onChange={(e) => setForm({ ...form, owners: e.target.value })} /></Stack>
      <Inline><Button appearance="primary" isLoading={busy} onClick={save}>{cp ? 'Save and screen again' : 'Screen this vendor'}</Button></Inline>
    </Stack>
  ) : null;
  const note = STATUS_NOTE[view?.assessment?.reason];
  return (
    <Stack space="space.200">
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      {!data?.list ? <Text>The sanctions lists are not loaded yet. Open Sanctions Hold from the Apps menu to load them.</Text> : null}
      {cp ? (
        <Stack space="space.150">
          <Inline space="space.100" alignBlock="center" shouldWrap><StatusLozenge status={cp.status} /><Text weight="medium">{cp.name}</Text></Inline>
          <Text color="color.text.subtle">{`${countryName(cp.country) || 'No country'} · ${cp.ownerDetails.length ? cp.ownerDetails.map(formatOwner).join(', ') : 'no owners given'} · screened ${fmtTime(cp.screened_at)} UTC against the lists updated ${cp.screened_version ? fmtVersion(cp.screened_version, { held: false }) : listDates(data.list)}`}</Text>
          {note ? <Text>{note}</Text> : null}
          <OwnershipNote view={view} onDone={load} />
          {open.map((h) => {
            const owner = ownerOfHit(h, cp);
            return (
              <Stack key={h.entryId} space="space.100">
                <Heading size="xsmall">{`${h.status === 'confirmed' ? 'Confirmed match' : h.status === 'dismissed' ? 'Dismissed match' : 'Possible match'} for ${owner ? `${owner.role === 'director' ? 'director' : 'owner'} ${owner.name}` : 'the company name'}`}</Heading>
                {h.status !== 'pending' ? <Inline><HitLozenge status={h.status} person={Boolean(owner)} /></Inline> : null}
                <MatchEvidence hit={h} cp={cp} />
                <ReviewedNote hit={h} />
                {h.status === 'pending' ? <ReviewForm hit={h} cp={cp} onDone={load} /> : null}
              </Stack>
            );
          })}
          {editing ? fields : <Inline><Button appearance="subtle" onClick={() => setEditing(true)}>Edit name, country or owners</Button></Inline>}
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
