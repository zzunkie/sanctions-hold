// Signs in to the Atlassian MCP server for one Forge app with OAuth (dynamic client registration and PKCE) and keeps
// the token in the token directory with owner-only permissions. The token is never printed.
// usage: node auth.mjs <appId>      (token directory: $MCP_TOKEN_DIR or ~/.sanctions-hold-mcp)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tokenDir } from './mcp-client.mjs';

const [appId] = process.argv.slice(2);
if (!appId) { console.error('usage: node auth.mjs <appId>'); process.exit(1); }
const dir = tokenDir();
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const SERVER = `https://mcp.atlassian.com/forge/${appId}`;
const AUTH = 'https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3';
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/callback`;
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const reg = await fetch(`${AUTH}/dcr/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'sanctions-hold-agent', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
});
const client = await reg.json();
if (!client.client_id) throw new Error(`client registration failed ${reg.status}`);
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(16));
const url = new URL('https://auth.atlassian.com/authorize');
Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state, resource: SERVER }).forEach(([k, v]) => url.searchParams.set(k, v));
console.log(`Open this address in a browser, sign in and allow access:\n\n${url}\n`);

const code = await new Promise((resolve, reject) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback') { res.end(); return; }
    res.end('Signed in. You can close this tab.');
    srv.close();
    if (u.searchParams.get('state') !== state) reject(new Error('state mismatch'));
    else if (u.searchParams.get('error')) reject(new Error(`sign-in error ${u.searchParams.get('error')}`));
    else resolve(u.searchParams.get('code'));
  }).listen(PORT, '127.0.0.1');
  setTimeout(() => { srv.close(); reject(new Error('no sign-in within 10 minutes')); }, 10 * 60 * 1000);
});
const tok = await fetch('https://auth.atlassian.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: SERVER }),
});
const t = await tok.json();
if (!t.access_token) throw new Error(`token request failed ${tok.status}`);
fs.writeFileSync(path.join(dir, 'token.json'), JSON.stringify({ ...t, client_id: client.client_id }), { mode: 0o600 });
console.log(`Signed in. The token is in ${dir}.`);
