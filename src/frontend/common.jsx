import React, { useEffect, useState } from 'react';
import { Lozenge, Text, Stack, Inline, Strong, Link, Button, TextArea, Label, SectionMessage, DynamicTable } from '@forge/react';
import { invoke } from '@forge/bridge';
import { COUNTRY_NAMES } from '../core/sample.js';
import { countryNameOf } from '../core/countries.js';
import { ownerList, formatOwner, peopleText } from '../core/owners.js';

// OFAC writes some countries differently ("Korea, South"), so both spellings are tried when comparing.
export const countryName = (c) => (c ? COUNTRY_NAMES[String(c).toUpperCase()] || countryNameOf(c) || c : '');
import { countrySpellings, compareOwner, compareRegistration } from '../core/evidence.js';

export async function call(name, payload = {}) {
  const res = await invoke(name, payload);
  if (!res?.ok) throw new Error(res?.error || `${name} failed`);
  return res;
}

export const STATUS = {
  blocked: { label: 'Blocked', appearance: 'removed', bold: true },
  review: { label: 'Waiting for review', appearance: 'moved' },
  cleared: { label: 'Cleared after review', appearance: 'success' },
  clear: { label: 'No match', appearance: 'success' },
  unscreened: { label: 'Not screened', appearance: 'default' },
};

export const StatusLozenge = ({ status }) => {
  const s = STATUS[status] || { label: status, appearance: 'default' };
  return <Lozenge appearance={s.appearance} isBold={Boolean(s.bold)}>{s.label}</Lozenge>;
};

const HIT = {
  pending: { label: 'Waiting for review', appearance: 'moved' },
  dismissed: { label: 'Not the same party', person: 'Not the same person', appearance: 'default' },
  confirmed: { label: 'Same party', person: 'Same person', appearance: 'removed' },
};
// A match the year-of-birth rule cleared is labeled as such, not as a reviewer's decision.
export const HitLozenge = ({ status, person = false, reviewedBy = null }) => {
  const s = reviewedBy === 'rule:birth-year' && status === 'dismissed' ? { label: 'Cleared by the year-of-birth rule', appearance: 'default' } : HIT[status] || { label: status, appearance: 'default' };
  return <Lozenge appearance={s.appearance}>{(person && s.person) || s.label}</Lozenge>;
};

const LIST_NAMES = { SDN: 'OFAC SDN List', CONS: 'OFAC Consolidated Sanctions List', UK: 'UK Sanctions List', EU: 'EU Consolidated Financial Sanctions List' };
export const listName = (l) => LIST_NAMES[l] || l || '';
// The reference a reviewer can look up on the list's own search: OFAC's entry number, the UK's
// Unique ID, the EU reference number.
export const entryRef = (hit) => {
  if (hit.entry?.list === 'UK') return String(hit.entryId || '').replace(/^UK:/, '');
  if (hit.entry?.list === 'EU') return /EU reference number (\S+?);/.exec(`${hit.entry.remarks || ''};`)?.[1] || String(hit.entryId || '').replace(/^EU:/, '');
  return hit.entry?.entNum;
};
// Current list dates, e.g. "OFAC 2026-11-23, UK 2026-11-24, EU 2026-11-20".
export const listDates = (l) => (l ? [`OFAC ${l.published || 'unknown'}`, l.ukPublished ? `UK ${l.ukPublished}` : null, l.euPublished ? `EU ${l.euPublished}` : null].filter(Boolean).join(', ') : '');
// Non-breaking hyphens keep a date on one line in narrow table columns.
export const fmtDate = (s) => (s ? String(s).slice(0, 10).replace(/-/g, '\u2011') : '');
export const fmtTime = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');
export const score = (n) => Number(n).toFixed(2);
// List versions look like "2026-11-23+2026-11-24+2026-11-20:6b7c553e" (OFAC, UK and EU dates), with ":held" for the demo hold-back.
// The work item panel leaves the hold-back out; the Overview explains it once.
export const fmtVersion = (v, { held: showHeld = true } = {}) => {
  if (!v) return '';
  const [dates, , held] = String(v).split(':');
  const [ofac, uk, eu] = dates.split('+');
  return `OFAC ${ofac}${uk ? `, UK ${uk}` : ''}${eu ? `, EU ${eu}` : ''}${held && showHeld ? ', newest SDN designations held back' : ''}`;
};
export const matchedText = (h) => (h.entry && h.entry.name !== h.matchedName ? `${h.matchedName} (alias of ${h.entry.name})` : h.entry?.name || h.matchedName);
// A non-breaking hyphen keeps a key such as VEND-5 on one line in narrow table cells.
export const IssueLink = ({ k }) => (k ? <Link href={`/browse/${k}`}>{k.replace('-', '\u2011')}</Link> : null);

// Cut a long text at a word boundary.
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n))}…`);

// The person or company a hit was found for: the company name, or one of its owners or directors.
export const ownerOfHit = (hit, cp) => (hit.queriedName === cp.name ? null
  : ownerList(cp.owners).find((o) => o.name.toLowerCase() === String(hit.queriedName).toLowerCase()) || { name: hit.queriedName, role: 'owner', share: null });

// Vendor side / list side: the countries for a company name, the nationalities for an owner or director.
export function placesOfHit(hit, cp) {
  const owner = ownerOfHit(hit, cp);
  if (!owner) return `${countryName(cp.country) || 'not given'} / ${hit.entry?.countries || 'none given'}`;
  const f = hit.entry ? compareOwner(owner, hit.entry) : {};
  const nationality = `Nationality: ${countryName(owner.nationality) || 'not given'} / ${f.nationality || 'none given'}`;
  // The year of birth too when either side gives one, so a namesake born decades apart shows in the queue.
  const listedYears = f.born ? [...new Set(String(f.born).match(/\b(?:18|19|20)\d{2}\b/g) || [])].join(', ') : null;
  return owner.born || listedYears ? `${nationality}; born ${owner.born ? String(owner.born).slice(0, 4) : 'not given'} / ${listedYears || 'none given'}` : nationality;
}

// The evidence a reviewer needs, side by side: what the vendor gave and what the list entry says.
// In the narrow sidebar (compact) only the entry and the year of birth, nationality or country are shown.
export function MatchEvidence({ hit, cp, compact = false }) {
  const [showRemarks, setShowRemarks] = useState(false);
  const e = hit.entry;
  if (!e) return <Text>{`${hit.matchedName} (${hit.entryId}); the list entry is no longer stored.`}</Text>;
  const owner = ownerOfHit(hit, cp);
  const aliases = e.aliases.map((a) => a.n).filter((n) => n !== hit.matchedName).slice(0, 8);
  const places = e.addresses.map((a) => [a.a, a.c, a.k].filter(Boolean).join(', ')).filter(Boolean).slice(0, 3);
  const listed = String(e.countries || '').toLowerCase();
  const sameCountry = cp.country && listed ? countrySpellings(cp.country).some((x) => listed.includes(x)) : null;
  const facts = compareOwner(owner, e);
  const reg = owner ? { ids: [], registrationCompared: null } : compareRegistration(cp.registrationNumber, e);
  // Red when the owner's detail agrees with the list entry, green when it differs.
  const tag = (cmp) => (cmp ? <Lozenge appearance={cmp === 'same' ? 'removed' : 'success'}>{cmp}</Lozenge> : null);
  const withTag = (text, cmp) => (cmp ? <Inline space="space.050" alignBlock="center" shouldWrap><Text>{text}</Text>{tag(cmp)}</Inline> : text);
  if (compact) {
    const line = (label, mine, theirs, cmp) => <Inline key={label} space="space.050" alignBlock="center" shouldWrap><Text>{`${label}: ${mine} / ${theirs}`}</Text>{tag(cmp)}</Inline>;
    return (
      <Stack space="space.075">
        <Text weight="medium">{matchedText(hit)}</Text>
        <Text color="color.text.subtle">{`${listName(e.list)} entry ${entryRef(hit)}${e.onList ? '' : ', since removed'}. Score ${score(hit.score)}.`}</Text>
        {owner
          ? [line('Born', owner.born || 'not given', facts.born || 'none given', facts.bornCompared), line('Nationality', countryName(owner.nationality) || 'not given', facts.nationality || 'none given', facts.nationalityCompared)]
          : [line('Country', countryName(cp.country) || 'not given', e.countries || 'none given', sameCountry === null ? null : sameCountry ? 'same' : 'differs'),
            ...(reg.registrationCompared ? [line('Registration', cp.registrationNumber, reg.registrationCompared === 'same' ? cp.registrationNumber : reg.ids.map((x) => x.value).slice(0, 3).join(', '), reg.registrationCompared)] : [])]}
        <Text color="color.text.subtle">{`${e.list === 'UK' || e.list === 'EU' ? 'Regime' : 'Program'}: ${e.programs || 'none given'}`}</Text>
      </Stack>
    );
  }
  const row = (key, label, mine, theirs) => ({ key, cells: [{ key: 'l', content: <Strong>{label}</Strong> }, { key: 'v', content: mine }, { key: 'e', content: theirs }] });
  const rows = [
    row('n', owner ? (owner.role === 'director' ? 'Director' : 'Owner') : 'Name', owner ? `${owner.name}${owner.role === 'director' ? ' (director)' : owner.share != null ? ` (${owner.share}%)` : ''}` : cp.name, matchedText(hit)),
    // For an owner or director the company's country says nothing about the person; nationality does.
    ...(owner ? [] : [row('c', 'Country', countryName(cp.country) || 'not given',
      <Inline space="space.050" alignBlock="center" shouldWrap><Text>{e.countries || 'none given'}</Text>{sameCountry === null ? null : <Lozenge appearance={sameCountry ? 'removed' : 'success'}>{sameCountry ? 'same' : 'differs'}</Lozenge>}</Inline>)]),
    // The kind only says something when it does not fit: a person matched to a company entry, or the reverse.
    ...((owner ? e.kind !== 'individual' : e.kind === 'individual') ? [row('t', 'Type', owner ? 'person' : 'company', e.kind)] : []),
    ...(e.kind === 'individual' && (facts.born || owner?.born) ? [row('b', 'Born', owner?.born || 'not given', withTag(facts.born || 'none given', facts.bornCompared))] : []),
    ...(e.kind === 'individual' && (facts.nationality || owner?.nationality) ? [row('i', 'Nationality', countryName(owner?.nationality) || 'not given', withTag(facts.nationality || 'none given', facts.nationalityCompared))] : []),
    // For a company: its registered address and registration or license number next to the entry's.
    ...(!owner && (cp.address || places.length) ? [row('a', 'Address', cp.address || 'not given', places.length ? places.join(' | ') : 'none given')] : []),
    ...(!owner && (cp.registrationNumber || reg.ids.length) ? [row('r', 'Registration', cp.registrationNumber || 'not given',
      withTag(reg.ids.length ? reg.ids.slice(0, 4).map((x) => `${x.label} ${x.value}`).join('; ') : 'none given', reg.registrationCompared))] : []),
  ];
  return (
    <Stack space="space.075">
      <Text>{`${listName(e.list)} entry ${entryRef(hit)}${e.onList ? '' : ', since removed from the list'}, ${e.list === 'UK' || e.list === 'EU' ? 'regime' : 'program'} ${e.programs || 'not given'}. Score ${score(hit.score)}${hit.matchedName !== e.name ? ', matched on an alias' : ''}.`}</Text>
      <DynamicTable head={{ cells: [{ key: 'l', content: '', width: 26 }, { key: 'v', content: 'This vendor', width: 37 }, { key: 'e', content: 'List entry', width: 37 }] }} rows={rows} />
      {aliases.length ? <Text color="color.text.subtle">{`Also known as: ${aliases.join('; ')}`}</Text> : null}
      {owner && places.length ? <Text color="color.text.subtle">{`Addresses on the entry: ${places.join(' | ')}`}</Text> : null}
      {e.remarks && showRemarks ? <Text color="color.text.subtle">{`${e.list === 'UK' ? 'UK list details' : e.list === 'EU' ? 'EU list details' : 'OFAC remarks'}: ${clip(e.remarks.replace(/^EU reference number \S+?(; |$)/, ''), 600)}`}</Text> : null}
      {e.remarks ? <Inline><Button appearance="subtle" spacing="compact" onClick={() => setShowRemarks(!showRemarks)}>{`${showRemarks ? 'Hide' : 'Show'} the ${e.list === 'UK' ? 'UK list details' : e.list === 'EU' ? 'EU list details' : 'OFAC remarks'}`}</Button></Inline> : null}
    </Stack>
  );
}

// Whether this user decides possible matches: everyone, unless Settings names a Jira group of reviewers.
let accessOnce = null;
export function useReviewAccess() {
  const [access, setAccess] = useState(null);
  useEffect(() => {
    accessOnce = accessOnce || call('reviewAccess').catch(() => ({ allowed: true, group: null }));
    accessOnce.then(setAccess);
  }, []);
  return access;
}
const ReviewersNote = ({ group }) => <Text color="color.text.subtle">{`Possible matches are decided by members of the Jira group ${group}.`}</Text>;

// Decision buttons with a required reason. For an owner or director the question is whether it is the same person.
export function ReviewForm({ hit, cp, onDone }) {
  const access = useReviewAccess();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const person = cp && hit.queriedName !== cp.name;
  const decide = async (decision) => {
    setBusy(decision);
    setError(null);
    try {
      const r = await call('review', { counterpartyId: hit.counterpartyId, entryId: hit.entryId, decision, reason });
      onDone(r);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (access && !access.allowed) return <ReviewersNote group={access.group} />;
  return (
    <Stack space="space.100">
      <Label labelFor={`reason-${hit.entryId}`}>Reason (kept in the audit record)</Label>
      <TextArea id={`reason-${hit.entryId}`} placeholder={person ? 'For example: passport checked against the date of birth and nationality on the entry' : 'For example: registration number and owners checked against the entry'} onChange={(ev) => setReason(ev.target.value)} />
      <Inline space="space.100">
        <Button isLoading={busy === 'dismissed'} onClick={() => decide('dismissed')}>{person ? 'Not the same person' : 'Not the same party'}</Button>
        <Button isLoading={busy === 'confirmed'} onClick={() => decide('confirmed')}>{person ? 'Same person' : 'Same party'}</Button>
      </Inline>
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
    </Stack>
  );
}

// What the confirmed owners and directors mean for the vendor, and the proceed/block decision when
// the listed people stay below the ownership thresholds.
const listedPeople = (a) => peopleText(a.people, { withShare: false });
// A company name such as "Ltd." already ends the sentence.
const stop = (s) => (/[.]$/.test(s) ? s : `${s}.`);
const one = (a) => (a.people || []).length === 1;
// Which ownership rules a confirmed minority owner or director falls short of, and what is left to decide.
const ruleNote = (a) => {
  const rules = [a.ofac || (!a.uk && !a.eu) ? "OFAC's 50 Percent Rule" : null, a.uk ? 'the UK ownership test' : null, a.eu ? 'the EU ownership rule' : null].filter(Boolean);
  const upper = (s) => s[0].toUpperCase() + s.slice(1);
  const none = rules.length === 1 ? `${upper(rules[0])} does not block` : rules.length === 2 ? `Neither ${rules[0]} nor ${rules[1]} blocks` : `${upper(rules.slice(0, -1).join(', '))} and ${rules[rules.length - 1]} do not block`;
  const uk = 'The UK also covers a company that a designated person controls, for example by appointing or removing a majority of the board, and adds up shares or voting rights held under a joint arrangement.';
  const eu = 'The EU also treats a company as controlled by a listed person who, for example, can appoint or remove a majority of its board or use all or part of its assets.';
  const control = [a.uk ? uk : null, a.eu ? eu : null].filter(Boolean);
  return [`${none} the company at this shareholding.`, ...control, control.length ? 'Check whether that applies.' : null].filter(Boolean).join(' ');
};
export function OwnershipNote({ view, onDone }) {
  const access = useReviewAccess();
  const a = view.assessment || {};
  const cp = view.counterparty;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [changing, setChanging] = useState(false);
  const decide = async (decision) => {
    setBusy(decision);
    setError(null);
    try { onDone(await call('decideVendor', { counterpartyId: cp.id, decision, reason })); setChanging(false); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  if (a.reason === 'fifty-percent') {
    return <SectionMessage appearance="error" title="Blocked under OFAC's 50 Percent Rule"><Text>{`${listedPeople(a)}, confirmed as ${one(a) ? 'an OFAC-listed person, holds' : 'OFAC-listed persons, hold'} ${a.share}% of ${stop(`${cp.name}${one(a) ? '' : ' together'}`)} OFAC treats a company owned 50% or more by blocked persons as blocked itself.`}</Text></SectionMessage>;
  }
  if (a.reason === 'uk-majority') {
    return <SectionMessage appearance="error" title="Blocked under the UK ownership test"><Text>{`${listedPeople(a)}, confirmed as listed on the UK Sanctions List, holds ${a.share}% of ${stop(cp.name)} The UK treats a company in which a designated person holds more than 50% as subject to the asset freeze.`}</Text></SectionMessage>;
  }
  if (a.reason === 'eu-ownership') {
    return <SectionMessage appearance="error" title="Blocked under the EU ownership rule"><Text>{`${listedPeople(a)}, confirmed on the EU consolidated list, ${one(a) ? 'holds' : 'hold a combined'} ${a.share}% of ${stop(cp.name)} Under the EU Best Practices, a company in which listed persons hold 50% or more in the aggregate is in principle owned by them, so in principle its assets are frozen and no funds or economic resources may be made available to it.`}</Text></SectionMessage>;
  }
  if (a.reason === 'share-unknown') {
    return <SectionMessage appearance="error" title="Owner's share missing"><Text>{`${listedPeople(a)} is confirmed as a listed person, and the share is not given. Approval stays blocked until the share is entered in Vendor details.`}</Text></SectionMessage>;
  }
  if (!['minority', 'reviewer-proceeded', 'reviewer-blocked'].includes(a.reason)) return null;
  const decided = a.reason !== 'minority';
  return (
    <SectionMessage appearance={decided ? (a.reason === 'reviewer-blocked' ? 'error' : 'success') : 'warning'} title={decided ? (a.reason === 'reviewer-blocked' ? 'Blocked by a reviewer' : 'Reviewer let the vendor proceed') : 'Listed minority owner or director'}>
      <Stack space="space.100">
        <Text>{`${listedPeople(a)} ${one(a) ? 'is' : 'are'} confirmed as listed and ${stop(a.share ? `${one(a) ? 'holds' : 'hold'} ${a.share}% of ${cp.name}${one(a) ? '' : ' together'}` : `${one(a) ? 'is a director' : 'are directors'}`)} ${ruleNote(a)} Sanctions on the listed person still apply.`}</Text>
        {decided ? <Text color="color.text.subtle">{`Decision on ${fmtDate(cp.decision_at)}: ${cp.decision_reason || ''}`}</Text> : null}
        {access && !access.allowed ? <ReviewersNote group={access.group} /> : decided && !changing ? (
          <Inline><Button appearance="subtle" onClick={() => setChanging(true)}>Change the decision</Button></Inline>
        ) : (
          <Stack space="space.100">
            <Label labelFor="vendor-decision">Reason (kept in the audit record)</Label>
            <TextArea id="vendor-decision" placeholder="For example: the listed shareholder has no role in management or in this contract; payments go to the company account only" onChange={(ev) => setReason(ev.target.value)} />
            <Inline space="space.100">
              {a.reason === 'reviewer-proceeded' ? null : <Button isLoading={busy === 'proceed'} onClick={() => decide('proceed')}>Proceed with approval</Button>}
              {a.reason === 'reviewer-blocked' ? null : <Button appearance="danger" isLoading={busy === 'block'} onClick={() => decide('block')}>Block the vendor</Button>}
            </Inline>
          </Stack>
        )}
        {error ? <Text color="color.text.danger">{error}</Text> : null}
      </Stack>
    </SectionMessage>
  );
}

export function ReviewedNote({ hit }) {
  if (!hit.reviewedAt) return null;
  if (hit.reviewedBy === 'rule:birth-year' && hit.status === 'dismissed') return <Text color="color.text.subtle">{`Cleared by the year-of-birth rule on ${fmtDate(hit.reviewedAt)}: ${hit.reason}`}</Text>;
  const was = hit.status === 'pending' ? 'Reviewed before; the list entry changed since. Earlier decision' : 'Decision';
  return <Text color="color.text.subtle">{`${was} on ${fmtDate(hit.reviewedAt)}: ${hit.reason || 'no reason given'}`}</Text>;
}
