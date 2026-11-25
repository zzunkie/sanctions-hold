import test from 'node:test';
import assert from 'node:assert/strict';
import { statusOf, assess, reconcile } from '../src/core/decision.js';

const found = (entries) => new Map(entries.map(([id, hash]) => [id, { score: 0.95, matchedName: id, queriedName: 'X', entryHash: hash }]));

test('a dismissed match stays dismissed while the list entry is unchanged, and reopens when it changes', () => {
  const existing = [{ entry_id: 'SDN:1', status: 'dismissed', active: 1, entry_hash: 'aaaa' }];
  const same = reconcile(existing, found([['SDN:1', 'aaaa']]));
  assert.equal(same.rows[0].status, 'dismissed');
  assert.equal(same.opened.length, 0);
  const changed = reconcile(existing, found([['SDN:1', 'bbbb']]));
  assert.equal(changed.rows[0].status, 'pending');
  assert.equal(changed.opened[0].reopened, true);
});

test('a confirmed match keeps the counterparty blocked after the entry leaves the list', () => {
  const existing = [{ entry_id: 'SDN:1', status: 'confirmed', active: 1, entry_hash: 'aaaa' }];
  const r = reconcile(existing, found([]));
  assert.deepEqual(r.lapsed, ['SDN:1']);
  assert.equal(statusOf([{ ...existing[0], active: 0 }]), 'blocked');
});

test('status: pending beats dismissed; lapsed pending matches do not count', () => {
  assert.equal(statusOf([{ status: 'dismissed', active: 1 }, { status: 'pending', active: 1 }]), 'review');
  assert.equal(statusOf([{ status: 'dismissed', active: 1 }, { status: 'pending', active: 0 }]), 'cleared');
  assert.equal(statusOf([]), 'clear');
});

test('owners: confirmed listed owners at 50% or more block the company; a minority owner needs a decision', () => {
  const cp = { name: 'Crescent Bay Marine Services FZE', owners: ['Ali Kalhor (60%)', 'Sara Haddad (40%)'] };
  const hit = (queried, status = 'confirmed') => ({ queried_name: queried, status, active: 1 });
  assert.deepEqual([assess([hit('Ali Kalhor')], cp).status, assess([hit('Ali Kalhor')], cp).reason], ['blocked', 'fifty-percent']);
  const minority = { name: 'Gulf Horizon Logistics LLC', owners: ['Ali Kalhor (20%)', 'Omar Nasser (80%)'] };
  assert.equal(assess([hit('Ali Kalhor')], minority).reason, 'minority');
  assert.equal(statusOf([hit('Ali Kalhor')], { ...minority, decision: 'proceed' }), 'cleared');
  assert.equal(statusOf([hit('Ali Kalhor')], { ...minority, decision: 'block' }), 'blocked');
  assert.equal(statusOf([hit('Ali Kalhor')], minority, { ownerRule: 'any' }), 'blocked');
  assert.equal(assess([hit('Ali Kalhor')], { name: 'X', owners: ['Ali Kalhor'] }).reason, 'share-unknown');
  assert.equal(assess([hit('Crescent Bay Marine Services FZE')], cp).reason, 'company');
});

test('UK-listed owners: one person above 50% blocks; holdings of different people are not added up', () => {
  const cp = { name: 'Northgate Metals Ltd', owners: ['Ivan Petrov (40%)', 'Oleg Sidorov (40%)', 'Anna Berg (20%)'] };
  const uk = (queried) => ({ entry_id: `UK:RUS${queried.length}`, queried_name: queried, status: 'confirmed', active: 1 });
  const ofac = (queried) => ({ entry_id: `SDN:${queried.length}`, queried_name: queried, status: 'confirmed', active: 1 });
  assert.equal(assess([uk('Ivan Petrov'), uk('Oleg Sidorov')], cp).reason, 'minority');
  assert.equal(assess([ofac('Ivan Petrov'), ofac('Oleg Sidorov')], cp).reason, 'fifty-percent');
  const majority = { name: 'Northgate Metals Ltd', owners: ['Ivan Petrov (51%)', 'Anna Berg (49%)'] };
  assert.equal(assess([uk('Ivan Petrov')], majority).reason, 'uk-majority');
  const half = { name: 'Northgate Metals Ltd', owners: ['Ivan Petrov (50%)', 'Anna Berg (50%)'] };
  assert.equal(assess([uk('Ivan Petrov')], half).reason, 'minority');
  assert.equal(assess([ofac('Ivan Petrov')], half).reason, 'fifty-percent');
});
