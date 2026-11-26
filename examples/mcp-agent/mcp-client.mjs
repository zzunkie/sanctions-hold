// A small MCP client for the Sanctions Hold tools on the Atlassian MCP server, used by agent.mjs.
// The OAuth token comes from auth.mjs, is refreshed here when it is about to expire, and is never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tokenDir = () => process.env.MCP_TOKEN_DIR || path.join(os.homedir(), '.sanctions-hold-mcp');

export const WIDTH = 92;
export const bold = (s) => `\x1b[1m${s}\x1b[0m`;
export const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const short = (n) => n.replace(/-[0-9a-f]{6,}$/, '');

export function wrap(s, indent) {
  const out = [];
  let line = '';
  for (const w of String(s).split(/\s+/)) {
    if (line && (indent + line.length + 1 + w.length) > WIDTH) { out.push(' '.repeat(indent) + line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(' '.repeat(indent) + line);
  return out.join('\n');
}

const shortList = (l) => ({ 'UK Sanctions List': 'UK', 'EU Consolidated Financial Sanctions List': 'EU', 'OFAC SDN List': 'OFAC SDN' }[l] || l || '');

// The lines worth reading on screen for each tool, after its answer.
export function details(tool, r) {
  if (tool.startsWith('screen-counterparty')) {
    return (r.matches || []).map((m) => `• ${m.screenedName || m.foundFor?.owner || ''} ~ ${[m.name, `${shortList(m.list)}${m.euReferenceNumber ? ` ${m.euReferenceNumber}` : ''}`, m.reviewed || m.review].filter(Boolean).join(', ')}`);
  }
  if (tool.startsWith('match-evidence')) {
    return (r.matches || []).map((m) => `• ${m.foundFor?.owner || r.name} ~ ${m.name}: year of birth ${m.compared?.yearOfBirth || 'not compared'}, nationality ${m.compared?.nationality || 'not compared'}${m.review && m.review !== 'waiting for review' ? ` (${m.review})` : ''}`);
  }
  if (tool.startsWith('list-changes')) return (r.newPossibleMatches || []).map((m) => `• ${m.vendor}${m.workItem ? ` (${m.workItem})` : ''} ~ ${m.matchedName}, ${m.listEntry}, ${m.approved ? 'approved' : 'not approved yet'}`);
  return [];
}

export async function connect(appId, tokenDir) {
  const tokenFile = path.join(tokenDir, 'token.json');
  const server = `https://mcp.atlassian.com/forge/${appId}`;
  async function token() {
    const t = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    const age = (Date.now() - fs.statSync(tokenFile).mtimeMs) / 1000;
    if (age < (t.expires_in || 3600) - 120) return t.access_token;
    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client_id, resource: server }),
    });
    const n = await res.json();
    if (!n.access_token) throw new Error(`token refresh failed ${res.status}; run auth.mjs again`);
    fs.writeFileSync(tokenFile, JSON.stringify({ ...t, ...n }), { mode: 0o600 });
    return n.access_token;
  }
  let session = null;
  let id = 1;
  async function rpc(method, params, notify = false) {
    const res = await fetch(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${await token()}`, ...(session ? { 'Mcp-Session-Id': session } : {}), 'Mcp-Protocol-Version': '2025-06-18' },
      body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: id++, method, params }),
    });
    session = res.headers.get('mcp-session-id') || session;
    const text = await res.text();
    if (notify) return null;
    return text.includes('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).pop() : (text ? JSON.parse(text) : null);
  }
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sanctions-hold-agent', version: '1' } });
  if (!init?.result) throw new Error('initialize failed');
  await rpc('notifications/initialized', {}, true);
  const tools = (await rpc('tools/list', {}))?.result?.tools || [];
  async function call(name, args) {
    const tool = tools.find((t) => t.name === name || short(t.name) === name);
    if (!tool) return { error: `no tool ${name}` };
    const r = await rpc('tools/call', { name: tool.name, arguments: args });
    return r?.result?.structuredContent ?? r?.result ?? r;
  }
  return { tools, call };
}
