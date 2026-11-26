# Sanctions Hold agent for the command line

A small agent that uses the Sanctions Hold tools through the Atlassian MCP server. It reads [SKILL.md](../../skills/sanctions-hold/SKILL.md) as its instructions, takes one request in plain language, and prints each tool call with its answer.

Requirements: Node.js 24, a Jira site with Rovo where Sanctions Hold is installed and a site admin has enabled its MCP tools (in admin.atlassian.com: Site settings → Connected apps → sanctions-hold → Details → "Enable tools"), and an Anthropic API key.

```sh
cd examples/mcp-agent
npm install
node auth.mjs 8e2ff4d2-2907-49ea-932f-fd389a12528e     # opens the sign-in; use your own app id if you deployed a copy
export ANTHROPIC_API_KEY=...                              # your key, set in your shell environment
node agent.mjs 8e2ff4d2-2907-49ea-932f-fd389a12528e "Did this week's list updates affect our vendors? Prepare review notes for any new match."
```

The token is kept in `~/.sanctions-hold-mcp` (or `$MCP_TOKEN_DIR`) with owner-only permissions and is refreshed when it expires. A third argument to `agent.mjs` saves the calls and answers as JSON.

Other requests to try:

- "We want to onboard Baltic Amber Logistics, a forwarder in Lithuania. Viktor Myachin, born 1961, Russian, owns 51% and Ona Petrauskiene 49%. Screen it and open the request."
- "Why can't VEND-2 be approved?"
