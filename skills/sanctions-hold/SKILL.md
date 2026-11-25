---
name: sanctions-hold
description: Screen a company or person against the U.S. Treasury OFAC sanctions lists and the UK Sanctions List, open a vendor onboarding request in Jira, check whether a vendor may be approved, and summarise recent list changes, using the Sanctions Hold tools on the Atlassian MCP server. Use before signing, paying, shipping to or onboarding a counterparty, or when someone asks whether a vendor is cleared.
---

# Sanctions Hold

Sanctions Hold is a Jira app that screens vendors and their owners against the OFAC SDN List, the OFAC Consolidated Sanctions List and the UK Sanctions List. Jira blocks a vendor's approval until a reviewer decides each possible match, and the app checks both sources for a new version every hour.

## Connect

Add the MCP server `https://mcp.atlassian.com/forge/8e2ff4d2-2907-49ea-932f-fd389a12528e` to your agent (HTTP transport, OAuth). If you deployed your own copy of the app, use your app ID from `manifest.yml` instead. The site needs Rovo, and a site admin must first enable the tools: admin.atlassian.com → your site → Connected apps → Sanctions Hold → View app details, and under "Expose tools to MCP-compatible apps" select "Enable tools".

## Tools

| Tool | Input | Use it when |
|---|---|---|
| `screen-counterparty` | `name`, optional `owners` and `country` | Before a quote, contract, payment or shipment to a party not yet known |
| `request-approval` | `name`, optional `country`, `owners` and `note` | The user wants to go ahead with a new vendor after screening it |
| `counterparty-status` | `counterparty`: vendor name or work item key such as `VEND-12` | Someone asks whether a known vendor is cleared, or why its approval is blocked |
| `list-changes` | optional `days` (1 to 90, default 7) | Someone asks what changed on the lists, or which vendors a recent designation affects |

Write `owners` as one string separated by semicolons, with each owner's share and each director marked, for example `Ali Kalhor 60%; Sara Haddad 40%; Omar Nasser director`. The share decides which ownership rule applies, so ask for it when the user names an owner without one.

## How to answer

1. Screen the legal name with the owners and directors. A company whose own name is clean gets a possible match when one of its owners or directors is listed.
2. Read `result`:
   - `possible_match`: name the closest list entry, its list, its program or regime, the score, and the owner or director it matched. Call it a possible match until a reviewer decides in Sanctions Hold; approval in Jira stays on hold until then.
   - `no_match`: no entry scored at or above the site's threshold on the lists as updated on the dates in `listPublished` (OFAC) and `ukListPublished` (UK).
3. If the user wants to go ahead, call `request-approval` with the same name, country and owners, and a short note on why the vendor is needed. Give the user the work item key it returns. Approval then waits in Jira.
4. If `knownCounterparty` is set, the vendor is already in Sanctions Hold, even if the user left out its legal form: give its work item key instead of opening a second request. When it or `counterparty-status` gives a status, use its `meaning` field: `clear` and `cleared` may be approved; `review` waits for a reviewer or a decision; `blocked` means a confirmed match, a confirmed owner under the OFAC or UK ownership rule, a confirmed owner without a share, or a reviewer's decision to block.
5. You may repeat the `answer` field word for word.
6. Do not try spelling variants to get a different result. The matcher already covers aliases, typos, transliteration, word order and missing middle names.

## Examples

- "We're about to sign with Dexterus Global in Dubai. OK?" → `screen-counterparty` with `Dexterus Global`, country `AE`. Possible match: DEXTEROUS GLOBAL DMCC (OFAC SDN List, IRAN-EO13902), score 0.99; approval in Jira stays on hold until a reviewer decides in Sanctions Hold.
- "Can we buy from Rheinhafen Steel Supply in Duisburg? Evgeny Zubitskiy owns 55%." → `screen-counterparty` with owners `Evgeny Zubitskiy 55%`, country `DE`: the owner matches ZUBITSKIY, Evgeny Borisovich on the UK Sanctions List (Russia). If the user still wants to go ahead, `request-approval` opens the request in Jira.
- "Can we buy from Lowlands Metal Trading?" on the sample site → `knownCounterparty` is VEND-7 (Lowlands Metal Trading B.V.): give its key and status, and do not open another request.
- "Why can't VEND-2 be approved?" → `counterparty-status` with `VEND-2`.
- "Did this week's list updates affect any of our vendors?" → `list-changes` with `7`.
