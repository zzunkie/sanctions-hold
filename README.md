# Sanctions Hold

Sanctions Hold is a Forge app for Jira Cloud that screens vendors and their owners against the U.S. Treasury OFAC sanctions lists and the UK Sanctions List. Jira's approval waits until a reviewer decides each possible match, and every vendor is screened again when a list changes.

Built for Atlassian Codegeist 2026 (Apps for Business Teams, Best app with Atlassian MCP).

## Features

- Lists: the OFAC SDN List and Consolidated Sanctions List from the OFAC Sanctions List Service, and the asset-freeze designations on the FCDO's UK Sanctions List: 23,959 company and individual entries with 30,605 aliases. The app checks both sources every hour and records each update entry by entry.
- A "Vendor details" custom field on the create screen and the work item: country of registration, owners with their share, and directors.
- Name matching for the company and each owner and director: aliases, one-letter typos, transliterations (Mohammad and Muhammad), first-name-first word order, legal suffixes, and a listed person searched by one given name and surname when the list also has middle names or a patronymic. Each word is weighted by how rare it is on the lists.
- Ownership rules from the list that names a confirmed owner: OFAC's 50 Percent Rule (listed owners holding 50% or more in the aggregate) and the UK test (one listed owner holding more than 50%; separate holdings are added up only under a joint arrangement, which the panel asks the reviewer to check). Below those, and for a listed director, the reviewer chooses to proceed or to block, with a reason.
- Jira setup in one click: a company-managed "Vendor onboarding" project whose Approve transition runs the app's `jira:workflowValidator`, a "Sanctions review" status and a "Close without approval" transition. Work items created in the projects you choose are screened under their summary, the vendor's legal name (a "New vendor:" prefix is left out), with the Vendor details field.
- A Sanctions Hold panel in the work item's right sidebar with the vendor's status and the evidence side by side: name, country, date of birth and nationality where the list gives them, program or regime, aliases, addresses and the list's remarks. The reviewer marks each possible match as the same party or not, with a reason that goes into the audit record and onto the work item as a comment.
- After each list update every vendor is screened again. An approved vendor with a new possible match moves back to Sanctions review and its work item gets a comment. A dismissed match comes back for review when its list entry changes.
- An accuracy test that runs inside the site on the lists as loaded.
- An audit record as CSV: screenings, possible matches, decisions with reasons, blocked approvals, approvals and list updates, each with the list version it used.
- Four MCP tools through the Atlassian MCP server: `screen-counterparty`, `request-approval`, `counterparty-status` and `list-changes`. See [skills/sanctions-hold/SKILL.md](skills/sanctions-hold/SKILL.md).
- A Sanctions Hold agent in Rovo that uses the same four actions: ask it about a supplier and it screens the company and owners, and opens the onboarding request in Jira when you want to go ahead.

## Try it with the sample vendors

1. In Jira, open Apps → Sanctions Hold and select "Load the lists and the sample vendors". It takes two to three minutes. The sample has 196 vendors, and five of them have a possible match.
2. On the Overview, select "Create the project". It creates Vendor onboarding (VEND) with seven requests.
3. Open VEND-1 (Dexterus Global DMCC) and try the Approve transition. Jira blocks it and names the possible match. Open "Sanctions Hold" in the right sidebar to see the evidence and decide.
4. VEND-2: confirm the 60% owner and the vendor is blocked under OFAC's 50 Percent Rule. VEND-6: confirm the 20% owner and choose whether to proceed. VEND-7: the 60% owner is on the UK list only; confirm him and the UK test blocks the vendor.
5. VEND-3 is close to an alias of an Iranian company; mark it "Not the same party" and it can be approved. VEND-4 has no match.
6. The sample starts from the latest OFAC publication without its newest SDN designations. On the Overview, select "Replay them as a list update". VEND-5, approved two months earlier, is matched by one of those designations and moves to Sanctions review with a comment. The approved vendor Berkeley Trading LLC, which has no work item, goes back to review as well.
7. The Accuracy tab shows the held-out result. "Run the test on the current lists" runs about 13,000 searches in the background, which takes about nine minutes.

To use the MCP tools on a site with Rovo, a site admin opens the site's Site settings in admin.atlassian.com → Connected apps → sanctions-hold → Details, and under "Expose tools to MCP-compatible apps" selects "Enable tools".

## Accuracy

`scripts/accuracy.mjs` draws 1,500 list entries and searches for each by its listed name, an alias and five kinds of variant. Recall is the share of those searches that find the entry. The false positive rates are the shares of real names not on the lists that are flagged: 3,400 company names from GLEIF LEI records (CC0) and 3,400 person names from Wikidata (CC0), 200 per country from 17 countries, less the 3 of each whose words equal a listed name, which are counted apart. The matcher was tuned on other samples; these were measured once, with the OFAC lists updated 2026-11-23 and the UK list updated 2026-11-24:

| Threshold | Recall | Companies flagged | People flagged |
|---|---|---|---|
| 0.88 | 99.7% (6,027 of 6,043) | 1.2% (42 of 3,397) | 2.0% (68 of 3,397) |
| 0.90 | 99.7% (6,027 of 6,043) | 0.7% (25 of 3,397) | 1.7% (58 of 3,397) |
| 0.92 (default) | 99.6% (6,021 of 6,043) | 0.3% (10 of 3,397) | 1.5% (51 of 3,397) |
| 0.94 | 99.6% (6,017 of 6,043) | 0.1% (5 of 3,397) | 1.3% (45 of 3,397) |

Recall by kind at 0.92: listed name, alias, word order and legal suffix 100%, one given name and surname 99.6%, one-letter typo 99.1%, transliteration 97.8%.

```sh
scripts/fetch-ofac.sh /tmp/ofac
curl -o /tmp/UK-Sanctions-List.xml https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml
UK=/tmp/UK-Sanctions-List.xml PEOPLE=src/data/people-negatives.json SEED=11 node scripts/accuracy.mjs /tmp/ofac src/data/negatives.json 0.92
UK=/tmp/UK-Sanctions-List.xml node scripts/sample-check.mjs /tmp/ofac     # which sample vendors match the current lists
```

## Develop

Requirements: Node.js 24 and the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/).

```sh
npm install
npm test                      # review decisions and ownership rules
forge register                # creates your own app id in manifest.yml
forge deploy
forge install --product jira --site <your-site>.atlassian.net
```

## Layout

| Path | What it holds |
|---|---|
| `src/core/match.js` | Name normalisation, tokens, blocking keys and scoring |
| `src/core/ofac.js`, `src/core/uk.js`, `src/core/records.js` | OFAC CSV and UK XML parsing, and the change detection between versions |
| `src/core/decision.js` | Vendor status from possible matches, review decisions and the ownership rules |
| `src/core/owners.js` | Owners and directors with their shares |
| `src/core/accuracy.js` | The accuracy test shared by the script and the app |
| `src/backend/` | Forge SQL schema, list import, the in-memory index, screening, vendors, Jira setup, the Vendor details field |
| `src/frontend/` | UI Kit global page, issue panel and custom field |
| `src/validator.js` | Workflow validator for the Approve transition |
| `src/events.js` | Product event triggers for new and edited work items and approvals |
| `src/jobs.js` | Hourly list check and queue consumer |
| `src/actions.js` | MCP tools |
| `src/data/` | The company and person names used to measure false positives, and the offline result |

## Data and privacy

See [PRIVACY.md](PRIVACY.md). Support: [GitHub Issues](https://github.com/zzunkie/sanctions-hold/issues).

## Data sources and licences

- OFAC sanctions lists: U.S. Treasury, Office of Foreign Assets Control, public domain.
- UK Sanctions List: Foreign, Commonwealth and Development Office. Contains public sector information licensed under the Open Government Licence v3.0.
- GLEIF LEI records (CC0 1.0) and Wikidata (CC0 1.0), used only for the accuracy test.

## License

[MIT](LICENSE)
