import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Box, Select, Textfield, Button, Label, Text, xcss } from '@forge/react';
import { CustomFieldEdit } from '@forge/react/jira';
import { view } from '@forge/bridge';
import { COUNTRIES, countryNameOf } from '../core/countries.js';

// UK is kept as an alias of GB for lookups; the picker lists the United Kingdom once.
const COUNTRY_OPTIONS = COUNTRIES.filter(([value]) => value !== 'UK').map(([value, label]) => ({ value, label }));
const ROLE_OPTIONS = [{ value: 'owner', label: 'Owner' }, { value: 'director', label: 'Director' }];
const nameBox = xcss({ width: '220px' });
const shareBox = xcss({ width: '96px' });
const roleBox = xcss({ width: '130px' });
const bornBox = xcss({ width: '150px' });
const affix = xcss({ paddingInline: 'space.100' });
const natBox = xcss({ width: '220px' });
const addressBox = xcss({ width: '360px' });
const regBox = xcss({ width: '200px' });
const YEAR = /^\d{4}(-\d{2}-\d{2})?$/;

// Keeps only rows with a name; a share is kept for owners and must be between 0 and 100; a year
// (or date) of birth and a nationality are kept when given.
function clean(v) {
  const owners = (v.owners || [])
    .map((o) => ({ ...o, name: String(o.name || '').trim(), role: o.role === 'director' ? 'director' : 'owner', share: o.share === '' || o.share == null ? null : Number(o.share), born: String(o.born || '').trim() }))
    .filter((o) => o.name)
    .map((o) => ({
      name: o.name, role: o.role, ...(o.role === 'owner' && Number.isFinite(o.share) && o.share >= 0 && o.share <= 100 ? { share: o.share } : {}),
      ...(YEAR.test(o.born) ? { born: o.born } : {}), ...(o.nationality ? { nationality: o.nationality } : {}),
    }));
  const address = String(v.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const registrationNumber = String(v.registrationNumber || '').trim().slice(0, 64);
  return { ...(v.country ? { country: v.country } : {}), ...(address ? { address } : {}), ...(registrationNumber ? { registrationNumber } : {}), owners };
}

function VendorDetailsEdit() {
  const [value, setValue] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  useEffect(() => {
    view.getContext().then((c) => {
      const v = c?.extension?.fieldValue ?? c?.fieldValue ?? null;
      setCreateMode((c?.extension?.renderContext || '') === 'issue-create');
      setValue({ country: v?.country || '', address: v?.address || '', registrationNumber: v?.registrationNumber || '', owners: (v?.owners || []).map((o) => ({ ...o, share: o.share ?? '', born: o.born ?? '', nationality: o.nationality || '' })) });
    });
  }, []);
  if (!value) return <Text>Loading</Text>;
  const update = (next) => setValue(next);
  const setOwner = (i, patch) => update({ ...value, owners: value.owners.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const body = (
    <Stack space="space.100">
      <Stack space="space.050">
        <Label labelFor="vd-country">Country of registration</Label>
        <Select inputId="vd-country" options={COUNTRY_OPTIONS} isClearable
          value={value.country ? { value: value.country, label: countryNameOf(value.country) || value.country } : null}
          onChange={(o) => update({ ...value, country: o?.value || '' })} />
      </Stack>
      <Inline space="space.100" shouldWrap>
        <Stack space="space.050">
          <Label labelFor="vd-address">Registered address</Label>
          <Box xcss={addressBox}><Textfield id="vd-address" placeholder="Street, city" value={value.address} onChange={(e) => update({ ...value, address: e.target.value })} /></Box>
        </Stack>
        <Stack space="space.050">
          <Label labelFor="vd-reg">Registration or license number</Label>
          <Box xcss={regBox}><Textfield id="vd-reg" value={value.registrationNumber} onChange={(e) => update({ ...value, registrationNumber: e.target.value })} /></Box>
        </Stack>
      </Inline>
      <Label labelFor="vd-owner-0">Owners and directors</Label>
      {value.owners.map((o, i) => (
        <Stack key={i} space="space.050">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Box xcss={nameBox}><Textfield id={`vd-owner-${i}`} aria-label="Full name" placeholder="Full name" value={o.name} onChange={(e) => setOwner(i, { name: e.target.value })} /></Box>
            <Box xcss={roleBox}><Select aria-label="Role" options={ROLE_OPTIONS} value={ROLE_OPTIONS.find((r) => r.value === (o.role || 'owner'))} onChange={(r) => setOwner(i, { role: r.value })} /></Box>
            {o.role !== 'director' ? <Box xcss={shareBox}><Textfield type="number" aria-label="Share (%)" placeholder="Share" elemAfterInput={<Box xcss={affix}><Text color="color.text.subtle">%</Text></Box>} value={String(o.share ?? '')} onChange={(e) => setOwner(i, { share: e.target.value })} /></Box> : null}
            <Button appearance="subtle" onClick={() => update({ ...value, owners: value.owners.filter((_, j) => j !== i) })}>Remove</Button>
          </Inline>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Box xcss={bornBox}><Textfield aria-label="Year of birth" placeholder="year" elemBeforeInput={<Box xcss={affix}><Text color="color.text.subtle">Born</Text></Box>} value={String(o.born ?? '')} onChange={(e) => setOwner(i, { born: e.target.value })} /></Box>
            <Text color="color.text.subtle">Nationality</Text>
            <Box xcss={natBox}><Select aria-label="Nationality" placeholder="Choose" options={COUNTRY_OPTIONS} isClearable
              value={o.nationality ? { value: o.nationality, label: countryNameOf(o.nationality) || o.nationality } : null}
              onChange={(c) => setOwner(i, { nationality: c?.value || '' })} /></Box>
          </Inline>
        </Stack>
      ))}
      <Inline><Button onClick={() => update({ ...value, owners: [...value.owners, { name: '', role: 'owner', share: '', born: '', nationality: '' }] })}>Add owner or director</Button></Inline>
    </Stack>
  );
  // On the create screen Jira takes the value when focus leaves the field; on the work item the
  // reviewer saves with the field's confirm button, so moving between the inputs does not save.
  const submit = () => view.submit(clean(value));
  if (createMode) return <CustomFieldEdit onSubmit={submit} disableSubmitOnEnter>{body}</CustomFieldEdit>;
  return <CustomFieldEdit onSubmit={submit} disableSubmitOnBlur disableSubmitOnEnter>{body}</CustomFieldEdit>;
}

ForgeReconciler.render(<React.StrictMode><VendorDetailsEdit /></React.StrictMode>);
