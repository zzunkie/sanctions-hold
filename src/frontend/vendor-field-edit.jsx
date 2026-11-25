import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Box, Select, Textfield, Button, Label, Text, xcss } from '@forge/react';
import { CustomFieldEdit } from '@forge/react/jira';
import { view } from '@forge/bridge';
import { COUNTRIES, countryNameOf } from '../core/countries.js';

const COUNTRY_OPTIONS = COUNTRIES.map(([value, label]) => ({ value, label }));
const ROLE_OPTIONS = [{ value: 'owner', label: 'Owner' }, { value: 'director', label: 'Director' }];
const nameBox = xcss({ width: '220px' });
const shareBox = xcss({ width: '80px' });
const roleBox = xcss({ width: '130px' });

// Keeps only rows with a name; a share is kept for owners and must be between 0 and 100.
function clean(v) {
  const owners = (v.owners || [])
    .map((o) => ({ name: String(o.name || '').trim(), role: o.role === 'director' ? 'director' : 'owner', share: o.share === '' || o.share == null ? null : Number(o.share) }))
    .filter((o) => o.name)
    .map((o) => ({ name: o.name, role: o.role, ...(o.role === 'owner' && Number.isFinite(o.share) && o.share >= 0 && o.share <= 100 ? { share: o.share } : {}) }));
  return { ...(v.country ? { country: v.country } : {}), owners };
}

function VendorDetailsEdit() {
  const [value, setValue] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  useEffect(() => {
    view.getContext().then((c) => {
      const v = c?.extension?.fieldValue ?? c?.fieldValue ?? null;
      setCreateMode((c?.extension?.renderContext || '') === 'issue-create');
      setValue({ country: v?.country || '', owners: (v?.owners || []).map((o) => ({ ...o, share: o.share ?? '' })) });
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
      <Label labelFor="vd-owner-0">Owners and directors</Label>
      {value.owners.map((o, i) => (
        <Inline key={i} space="space.100" alignBlock="center" shouldWrap>
          <Box xcss={nameBox}><Textfield id={`vd-owner-${i}`} placeholder="Full name" value={o.name} onChange={(e) => setOwner(i, { name: e.target.value })} /></Box>
          <Box xcss={roleBox}><Select options={ROLE_OPTIONS} value={ROLE_OPTIONS.find((r) => r.value === (o.role || 'owner'))} onChange={(r) => setOwner(i, { role: r.value })} /></Box>
          {o.role !== 'director' ? <Box xcss={shareBox}><Textfield type="number" placeholder="%" value={String(o.share ?? '')} onChange={(e) => setOwner(i, { share: e.target.value })} /></Box> : null}
          <Button appearance="subtle" onClick={() => update({ ...value, owners: value.owners.filter((_, j) => j !== i) })}>Remove</Button>
        </Inline>
      ))}
      <Inline><Button onClick={() => update({ ...value, owners: [...value.owners, { name: '', role: 'owner', share: '' }] })}>Add owner or director</Button></Inline>
    </Stack>
  );
  // On the create screen Jira takes the value when focus leaves the field; on the work item the
  // reviewer saves with the field's confirm button, so moving between the inputs does not save.
  const submit = () => view.submit(clean(value));
  if (createMode) return <CustomFieldEdit onSubmit={submit} disableSubmitOnEnter>{body}</CustomFieldEdit>;
  return <CustomFieldEdit onSubmit={submit} disableSubmitOnBlur disableSubmitOnEnter>{body}</CustomFieldEdit>;
}

ForgeReconciler.render(<React.StrictMode><VendorDetailsEdit /></React.StrictMode>);
