---
name: sanctions-hold
description: Screen a company or person and its owners and directors against the U.S. Treasury OFAC sanctions lists, the UK Sanctions List and the EU Consolidated Financial Sanctions List, open a vendor onboarding request in Jira, check whether a vendor may be approved, prepare review notes on a vendor's matches, and summarise recent list changes, using the Sanctions Hold tools in Rovo or on the Atlassian MCP server. Use when someone asks about a new supplier or customer, whether a vendor is cleared, or what a list update changed.
allowed-tools: screen-counterparty request-approval counterparty-status list-changes match-evidence add-review-note
---

# Sanctions Hold

Sanctions Hold is a Jira app that screens vendors, owners and directors against the OFAC SDN List, the OFAC Consolidated Sanctions List, the UK Sanctions List and the EU Consolidated Financial Sanctions List. Jira blocks a vendor's approval until a reviewer decides each possible match, and the app checks all three sources for a new version every hour.

## Connect

In Rovo, use the Sanctions Hold agent, or add this skill to your own agent. For another agent, add the MCP server `https://mcp.atlassian.com/forge/8e2ff4d2-2907-49ea-932f-fd389a12528e` (HTTP transport, OAuth). If you deployed your own copy of the app, use your app ID from `manifest.yml` instead. The site needs Rovo, and a site admin must first enable the tools: in admin.atlassian.com, open the site's Site settings → Connected apps → sanctions-hold → Details, and under "Expose tools to MCP-compatible apps" select "Enable tools".

## Tools

| Tool | Input | Use it when |
|---|---|---|
| `screen-counterparty` | `name`, optional `owners` and `country` | Someone asks about a supplier or customer before a quote, contract, payment or shipment |
| `request-approval` | `name`, optional `country`, `owners` and `note` | The user wants to go ahead with a new vendor after screening it |
| `counterparty-status` | `counterparty`: vendor name or work item key such as `VEND-9` | Someone asks whether a known vendor is cleared, or why its approval is blocked |
| `match-evidence` | `counterparty`: vendor name or work item key | Someone asks you to prepare or check the review of a vendor's matches |
| `add-review-note` | `workItem`, `notes` | The user wants your review notes on the vendor's work item |
| `list-changes` | optional `days` (1 to 90, default 7) | Someone asks what changed on the lists, or which vendors a recent designation affects |

Write `owners` as one string separated by semicolons, with each owner's share, a year of birth and nationality when known, and each director marked, for example `Ali Kalhor 60% born 1963 nationality Iran; Sara Haddad 40%; Omar Nasser director`. The share decides which ownership rule applies, so ask for it when the user names an owner without one.

## How to answer

1. Screen the legal name with the owners and directors. A company whose own name is clean gets a possible match when one of its owners or directors is listed.
2. Read `result`:
   - `possible_match`: name the closest list entry, its list, its program or regime, the score, and the owner or director it matched. Call it a possible match until a reviewer decides in Sanctions Hold; approval in Jira stays on hold until then.
   - `confirmed_match`: the vendor is already in Sanctions Hold and a reviewer confirmed the match (`reviewed` is `confirmed`). Give the list entry and the vendor's status.
   - `no_match`: no open or confirmed match at or above the site's threshold on the lists as updated on the dates in `listPublished` (OFAC), `ukListPublished` (UK) and `euListPublished` (EU).
3. If the user wants to go ahead, call `request-approval` with the same name, country and owners, and a short note on why the vendor is needed. Give the user the work item key it returns. Approval then waits in Jira.
4. If `knownCounterparty` is set, the vendor is already in Sanctions Hold, even if the user left out its legal form. It was screened with the owners and directors on its record (`screenedOwners`). Give its work item key instead of opening a second request. When it or `counterparty-status` gives a status, use its `meaning` field: `clear` and `cleared` may be approved; `review` waits for a reviewer or a decision; `blocked` means a confirmed match, a confirmed owner under the OFAC, UK or EU ownership rule, a confirmed owner without a share, or a reviewer's decision to block.
5. To prepare a review, call `match-evidence` and go through each match waiting for review. For each match, give the list entry and its list, say which details agree, which differ and which are missing, and add what the entry's remarks say, such as the place of birth, the person's role, or the companies and groups they name. For a person, `compared` says whether the year of birth and the nationality agree; also say which listed names the owner's name leaves out. For a company, compare the name and the country, and note what the entry's aliases, addresses and remarks add. After all matches, say once what the reviewer could ask the requester for, such as the owner's passport. Use only what the vendor's record and the list entry say. The record has no address for an owner, so leave out where the owner lives; `companyRegisteredIn` is the company's country, not the owner's. When an entry gives several nationalities or dates of birth, give all of them. Post the notes with `add-review-note`, one short point per line; in a chat, offer first.
6. Do not try spelling variants to get a different result. The matcher already covers aliases, typos, transliteration, word order and missing middle names.

## Examples

- "We're about to sign with Dexterus Global in Dubai. OK?" → `screen-counterparty` with `Dexterus Global`, country `AE`. Possible match: DEXTEROUS GLOBAL DMCC (OFAC SDN List, IRAN-EO13902), score 0.99; approval in Jira stays on hold until a reviewer decides in Sanctions Hold.
- "Can we buy from Rheinhafen Steel Supply in Duisburg? Evgeny Zubitskiy owns 55%." → `screen-counterparty` with owners `Evgeny Zubitskiy 55%`, country `DE`: the owner matches ZUBITSKIY, Evgeny Borisovich on the UK Sanctions List and on the EU list. If the user still wants to go ahead, `request-approval` opens the request in Jira.
- "Prepare the review notes for Savannah Freight Ltd." on the sample site → `match-evidence`: the owner Yusuf Ibrahim, born 1990, Kenyan, matched IBRAHIM, Aadan Yusuf Saciid (born 1987 to 1989, Somalia) and EBRAHIMI, Yousef (born 1977; nationality Iran, also Turkey and Dominica). Both differ in year of birth and nationality. Post the notes on the work item.
- "Can we buy from Lowlands Metal Trading?" on the sample site → `knownCounterparty` is the Lowlands Metal Trading B.V. work item: its 60% owner matches TATTERSALL, Alexander Jan Hendrik on the UK Sanctions List. Once a reviewer confirms the match, `result` is `confirmed_match` and approval stays blocked under the UK ownership test. Do not open another request.
- "Can we approve Klaipeda Machine Parts?" on the sample site → `knownCounterparty` is the Klaipeda Machine Parts UAB work item: its 30% and 25% owners match NIKOLAYEV, Konstantin Yuryevich and ATLIVANCHIK, Sergey Nikolaevich on the EU list only. Once a reviewer confirms both, approval stays blocked under the EU ownership rule, which adds up their 55%.
- "Why can't VEND-2 be approved?" → `counterparty-status` with `VEND-2`.
- "Did this week's list updates affect any of our vendors?" → `list-changes` with `7`.
