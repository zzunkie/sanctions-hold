import React from 'react';
import ForgeReconciler, { Stack, Text, useProductContext } from '@forge/react';
import { countryNameOf } from '../core/countries.js';
import { formatOwner } from '../core/owners.js';

function VendorDetails() {
  const context = useProductContext();
  const v = context?.extension?.fieldValue;
  const company = [v?.country ? countryNameOf(v.country) || v.country : null, v?.address, v?.registrationNumber ? `Registration ${v.registrationNumber}` : null].filter(Boolean);
  const people = (v?.owners || []).map(formatOwner);
  if (!company.length && !people.length) return <Text>None</Text>;
  return (
    <Stack space="space.050">
      {company.length ? <Text>{company.join(' · ')}</Text> : null}
      {people.length ? <Text>{people.join(' · ')}</Text> : null}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><VendorDetails /></React.StrictMode>);
