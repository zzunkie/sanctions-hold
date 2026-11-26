// What a screening result means for a counterparty, and how a new result is merged with the
// review decisions already made.

import { ownerList } from './owners.js';

// Counterparty status:
//   blocked  a reviewer confirmed a match on the company name; or confirmed owners listed by OFAC
//            hold 50% or more together (OFAC's 50 Percent Rule); or one confirmed owner listed by
//            the UK holds more than 50% (UK ownership test, holdings of different people are not
//            added up); or confirmed owners listed by the EU hold 50% or more together (EU Best
//            Practices 2024, paragraph 63); or a confirmed owner's share is not given; or a
//            reviewer chose to block after a confirmed minority owner or director
//   review   a possible match waits for a reviewer, or a confirmed minority owner or director
//            waits for the decision whether to proceed
//   cleared  every possible match was dismissed, or the reviewer chose to proceed
//   clear    no possible match
// policy.ownerRule: 'fifty' (default) applies the ownership rules above; 'any' blocks on any
// confirmed owner or director. cp: { name, owners, decision } where decision is 'proceed' | 'block' | null.
// The list a hit is on: 'UK', 'EU' or 'OFAC' (SDN and Consolidated).
export const listOfHit = (h) => {
  const id = String(h.entry_id ?? h.entryId ?? '');
  return id.startsWith('UK:') ? 'UK' : id.startsWith('EU:') ? 'EU' : 'OFAC';
};

export function assess(hits, cp = {}, policy = {}) {
  const owners = new Map(ownerList(cp.owners).map((o) => [o.name.toLowerCase(), o]));
  const ownerOf = (h) => owners.get(String(h.queried_name ?? h.queriedName ?? '').toLowerCase()) || null;
  const confirmed = hits.filter((h) => h.status === 'confirmed');
  const pending = hits.some((h) => h.status === 'pending' && Number(h.active));
  if (confirmed.some((h) => !ownerOf(h))) return { status: 'blocked', reason: 'company' };
  if (confirmed.length) {
    const peopleOf = (hs) => [...new Map(hs.map((h) => [ownerOf(h).name, ownerOf(h)])).values()];
    const shareOf = (ps) => ps.filter((o) => o.role === 'owner' && o.share != null).reduce((a, o) => a + o.share, 0);
    const people = peopleOf(confirmed);
    const base = { people, share: shareOf(people) };
    if (policy.ownerRule === 'any') return { status: 'blocked', reason: 'listed-person', ...base };
    if (people.some((o) => o.role === 'owner' && o.share == null)) return { status: 'blocked', reason: 'share-unknown', ...base };
    const on = (list) => confirmed.filter((h) => listOfHit(h) === list);
    const ofac = peopleOf(on('OFAC'));
    if (shareOf(ofac) >= 50) return { status: 'blocked', reason: 'fifty-percent', people: ofac, share: shareOf(ofac) };
    const ukMajority = peopleOf(on('UK')).find((o) => o.role === 'owner' && o.share > 50);
    if (ukMajority) return { status: 'blocked', reason: 'uk-majority', people: [ukMajority], share: ukMajority.share };
    const eu = peopleOf(on('EU'));
    if (shareOf(eu) >= 50) return { status: 'blocked', reason: 'eu-ownership', people: eu, share: shareOf(eu) };
    // Which lists name the confirmed people, for the note on the rules that did not block.
    const lists = { ofac: on('OFAC').length > 0, uk: on('UK').length > 0, eu: on('EU').length > 0 };
    if (pending) return { status: 'review', reason: 'pending', ...base };
    if (cp.decision === 'block') return { status: 'blocked', reason: 'reviewer-blocked', ...lists, ...base };
    if (cp.decision === 'proceed') return { status: 'cleared', reason: 'reviewer-proceeded', ...lists, ...base };
    return { status: 'review', reason: 'minority', ...lists, ...base };
  }
  if (pending) return { status: 'review', reason: 'pending' };
  if (hits.some((h) => h.status === 'dismissed' && Number(h.active))) return { status: 'cleared', reason: 'dismissed' };
  return { status: 'clear', reason: 'none' };
}

export const statusOf = (hits, cp, policy) => assess(hits, cp, policy).status;

export const MAY_APPROVE = new Set(['clear', 'cleared']);

// existing: stored hits of one counterparty. found: Map entryId -> {score, matchedName, queriedName, entryHash}.
// A dismissed match comes back for review when the list entry itself changed since the review.
// A confirmed match stays until a reviewer releases it, even if the entry leaves the list.
export function reconcile(existing, found) {
  const byEntry = new Map(existing.map((h) => [h.entry_id, h]));
  const rows = [];
  const opened = [];
  for (const [entryId, f] of found) {
    const h = byEntry.get(entryId);
    let status = 'pending';
    let reopened = false;
    if (h?.status === 'confirmed') status = 'confirmed';
    else if (h?.status === 'dismissed') {
      if (h.entry_hash === f.entryHash) status = 'dismissed';
      else reopened = true;
    }
    if (!h || reopened || (h.status === 'pending' && !Number(h.active))) opened.push({ entryId, reopened, ...f });
    rows.push({
      entry_id: entryId,
      status,
      active: 1,
      score: f.score,
      matched_name: f.matchedName,
      queried_name: f.queriedName,
      entry_hash: f.entryHash,
      isNew: !h,
      reviewed: status === 'pending' ? null : h,
    });
  }
  const lapsed = existing.filter((h) => Number(h.active) && !found.has(h.entry_id)).map((h) => h.entry_id);
  return { rows, opened, lapsed };
}
