// A command-line agent with the app's SKILL.md as its instructions and the Sanctions Hold tools from the Atlassian
// MCP server. It takes one request in plain language and prints each tool call it makes.
// usage: ANTHROPIC_API_KEY=... node agent.mjs <appId> "<request>" [transcript.json]
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { connect, tokenDir, wrap, details, short, bold, cyan, dim } from './mcp-client.mjs';

const [appId, request, out] = process.argv.slice(2);
if (!appId || !request) { console.error('usage: node agent.mjs <appId> "<request>" [transcript.json]'); process.exit(1); }
const SKILL = new URL('../../skills/sanctions-hold/SKILL.md', import.meta.url);
const skill = fs.readFileSync(SKILL, 'utf8').replace(/^---[\s\S]*?---\n/, '');
const system = `You are a procurement assistant connected to the Sanctions Hold tools in Jira through the Atlassian MCP server. Follow this skill file. You run in a terminal with one request and no one to answer follow-up questions, so do what the request asks without offering first: when it asks for review notes, post them with add-review-note. End with a plain-text reply of a few lines that says what you found and any work items you opened or commented on.\n\n${skill}`;

const { tools, call } = await connect(appId, tokenDir());
const defs = tools.map((t) => ({ name: short(t.name), description: t.description || '', input_schema: t.inputSchema || { type: 'object', properties: {} } }));
const client = new Anthropic();
console.log(`${bold('examples/mcp-agent')} with the Sanctions Hold skill, connected to mcp.atlassian.com (${defs.length} tools)`);
console.log(`\n${bold('Request:')} ${wrap(request, 9).trimStart()}`);

const messages = [{ role: 'user', content: request }];
const log = [];
for (let turn = 0; turn < 12; turn += 1) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    tools: defs,
    messages,
  });
  if (response.stop_reason === 'refusal') { console.log('The request was declined.'); break; }
  messages.push({ role: 'assistant', content: response.content });
  const uses = response.content.filter((b) => b.type === 'tool_use');
  if (!uses.length) {
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    console.log(`\n${bold('Agent:')}`);
    for (const para of text.split(/\n+/)) {
      if (/^\s*-{3,}\s*$/.test(para)) continue;
      const heading = /^\s*#+\s+/.test(para);
      const plain = para.replace(/^\s*#+\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1');
      console.log(heading ? bold(wrap(plain, 2)) : wrap(plain, 2));
    }
    log.push({ answer: text });
    break;
  }
  const results = [];
  for (const u of uses) {
    console.log(`\n${cyan(bold(`> ${u.name}`))}`);
    for (const [k, v] of Object.entries(u.input || {})) {
      const flat = String(v).replace(/\s*\n\s*/g, ' / ');
      console.log(dim(wrap(`${k}: ${flat.length > 160 ? `${flat.slice(0, 157)}...` : flat}`, 2)));
    }
    const res = await call(u.name, u.input || {});
    console.log(wrap(res?.answer || JSON.stringify(res).slice(0, 300), 2));
    for (const d of details(u.name, res || {})) console.log(dim(wrap(d, 2)));
    log.push({ call: u.name, args: u.input, result: res });
    results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(res) });
  }
  messages.push({ role: 'user', content: results });
}
if (out) fs.writeFileSync(out, JSON.stringify(log, null, 1));
