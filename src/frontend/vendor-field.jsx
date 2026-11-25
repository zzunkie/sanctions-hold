import React from 'react';
import ForgeReconciler, { Text, useProductContext } from '@forge/react';
import { countryNameOf } from '../core/countries.js';
import { formatOwner } from '../core/owners.js';

function VendorDetails() {
  const context = useProductContext();
  const v = context?.extension?.fieldValue;
  const parts = [v?.country ? countryNameOf(v.country) || v.country : null, ...(v?.owners || []).map(formatOwner)].filter(Boolean);
  return <Text>{parts.length ? parts.join(' · ') : 'None'}</Text>;
}

ForgeReconciler.render(<React.StrictMode><VendorDetails /></React.StrictMode>);
