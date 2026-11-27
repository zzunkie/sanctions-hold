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
| `screen-counterparty` | `name`; optional `country`, `registrationNumber` and `owners` | Someone asks about a supplier or customer before a quote, contract, payment or shipment |
| `request-approval` | `name`, optional `country`, `address`, `registrationNumber`, `owners` and `note` | The user wants to go ahead with a new vendor after screening it |
| `counterparty-status` | `counterparty`: vendor name or work item key such as `VEND-9` | Someone asks whether a known vendor is cleared, or why its approval is blocked |
| `match-evidence` | `counterparty`: vendor name or work item key | Someone asks you to prepare or check the review of a vendor's matches |
| `add-review-note` | `workItem`, `notes` | The user wants your review notes on the vendor's work item |
| `list-changes` | optional `days` (1 to 90, default 7) | Someone asks what changed on the lists, or which vendors a recent designation affects |

Write `owners` as one string separated by semicolons, with each owner's share, a year of birth and nationality when known, and each director marked, for example `Ali Kalhor 60% born 1963 nationality Iran; Sara Haddad 40%; Omar Nasser director`. The share decides which ownership rule applies, so ask for it when the user names an owner without one.

## How to answer

1. Screen the legal name with the owners and directors, and with the country and registration number when the user gives them. A company whose own name is clean gets a possible match when one of its owners or directors is listed, or when a list entry gives its registration number.
2. Read `result`:
   - `possible_match`: name the closest list entry, its list, its program or regime, the score to two decimal places (such as 0.97 or 1.00), and the owner or director it matched, or the registration number when `matchedOn` gives one. Call it a possible match until a reviewer decides in Sanctions Hold; approval in Jira stays on hold until then.
   - `confirmed_match`: the vendor is already in Sanctions Hold and a reviewer confirmed the match (`reviewed` is `confirmed`). Give the list entry and the vendor's status.
   - `no_match`: no open or confirmed match at or above the site's threshold on the lists as updated on the dates in `listPublished` (OFAC), `ukListPublished` (UK) and `euListPublished` (EU).
3. If the user wants to go ahead, call `request-approval` with the same name, country and owners, the address and registration number when the user gave them, and a short note on why the vendor is needed. Give the user the work item key it returns. Approval then waits in Jira.
4. If `knownCounterparty` is set, the vendor is already in Sanctions Hold, even if the user left out its legal form. It was screened with the owners and directors on its record (`screenedOwners`). Give its work item key instead of opening a second request. When it or `counterparty-status` gives a status, use its `meaning` field: `clear` and `cleared` may be approved; `review` waits for a reviewer or a decision; `blocked` means a confirmed match, a confirmed owner under the OFAC, UK or EU ownership rule, a confirmed owner without a share, or a reviewer's decision to block.
5. To prepare a review, call `match-evidence` and go through each match waiting for review.
   - Start each match with one line naming the list entry, its list and its program or regime, in the form "ENTRY NAME (list, program)". Then write one line per detail in the form "Label: owner <value>, entry <value>" ("vendor" for a company), ending the lines other than Name and Remarks with "(same)" or "(differs)" where `compared` says so. For a person the labels are Name, Year of birth, Nationality and Remarks; for a company, Name, Country, Address, Registration and Remarks.
   - Write the Name line as "Name: owner <name>, entry <entry name>, score <score>", or "Name: owner <name>, entry alias <alias>, score <score>" when the match is on an alias, with the names written as the record and the list give them; when the vendor was found by its registration number, say so. When the entry has given names or a patronymic that the owner's name does not, add "; the entry also gives <names>". Say nothing else about how the name matched.
   - The Remarks line comes last. In a sentence or two of plain words, say what the entry's remarks add to the other lines, such as the person's role, the place of birth when no other line gives it, or the companies and groups they name, without repeating anything another line gives. Spell out the list's abbreviations, such as POB (place of birth) and a.k.a. (also known as).
   - For each detail that people wrote on the work item (`fromTheWorkItem`), such as a date or place of birth, a passport number or a registration number, add a line "Label (work item): owner <value>, entry <value>", with the detail as the label and the entry's value, or "entry none" when the entry gives none; when the entry gives a value, end with "(same)" or "(differs)". A full date of birth from the work item replaces the Year of birth line, in the form "Date of birth: owner <date> (work item), entry <the entry's dates or years>". A place of birth from the work item gets its own line with the place of birth from the entry's remarks. Give the passport or ID numbers from both sides. If people wrote no such details, leave these lines out. Name attached files that bear on the match.
   - Use only what the vendor's record, the work item and the list entry say. Do not take a place of birth from an address, or an owner's nationality from the company's country, and leave out the entry's gender. When an entry gives several nationalities or dates of birth, give all of them, joined with commas and "and".
   - End the notes, after all matches, with one line on what settles or would settle them. A registration, license, passport or ID number that the record and the entry share settles a match, and so does a person's year of birth and nationality that differ from every entry with no such number in common: say which. In all other cases, even when a company's country or registration number differs, name the attached file or the registration, ownership or identity document to request.
   - Post the notes with `add-review-note`, one point per line and a blank line between matches. In the reply, give each vendor's result once and say what you posted, without calling a match the same or a different party, and without mentioning actions you did not take.
6. Do not try spelling variants to get a different result. The matcher already covers aliases, typos, transliteration, word order and missing middle names.

## Examples

- "We're about to sign with Harbor Point Trading LLC in Dubai. OK?" → `screen-counterparty` with `Harbor Point Trading LLC` and country `AE`; give any possible match with its list, program and score, and say that approval waits for a reviewer.
- "Can we buy from Elbe Metal Supply GmbH in Hamburg? Jan Kowalski owns 60%." → `screen-counterparty` with owners `Jan Kowalski 60%` and country `DE`. If the user still wants to go ahead, `request-approval` opens the request in Jira.
- "Prepare the review notes for VEND-31." → `match-evidence` on `VEND-31`, then post the notes with `add-review-note`.
- "Can we buy from Northgate Packaging?" → `screen-counterparty`; when `knownCounterparty` is set, give the existing work item and its status, and do not open another request.
- "Why can't VEND-40 be approved?" → `counterparty-status` with `VEND-40`.
- "Which vendors did the list updates of the past week affect? Add review notes for new matches." → `list-changes` with `7`; for each vendor in `newPossibleMatches` with a work item, call `match-evidence` on that work item, then post the notes with `add-review-note`.
