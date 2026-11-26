# Sanctions Hold

Sanctions Hold is a Forge app for Jira Cloud that screens vendors, owners and directors against the U.S. Treasury OFAC sanctions lists, the UK Sanctions List and the EU Consolidated Financial Sanctions List. Jira holds a vendor's approval while a possible match waits for review or a confirmed match blocks the vendor, and every vendor is screened again when a list changes.

Built for Atlassian Codegeist 2026 (Apps for Business Teams; bonus: Best app with Atlassian MCP, Best Agents - Rovo/Assignable agents).

## Features

- Lists: the OFAC SDN List and Consolidated Sanctions List from the OFAC Sanctions List Service, the asset-freeze designations on the FCDO's UK Sanctions List, and the European Commission's consolidated list of persons, groups and entities subject to EU financial sanctions: 30,262 company and individual entries with 48,238 aliases. The app checks all three sources every hour and records each update entry by entry.
- A "Vendor details" custom field on the create screen and the work item: country of registration, owners with their share, year of birth and nationality, and directors.
- Name matching for the company and each owner and director: aliases, one-letter typos, transliterations (Mohammad and Muhammad), first-name-first word order, legal suffixes, and a listed person searched by one given name and surname when the list also has middle names or a patronymic. Each word is weighted by how rare it is on the lists.
- Ownership rules from the list that names a confirmed owner: OFAC's 50 Percent Rule (listed owners holding 50% or more in the aggregate), the EU rule (listed owners holding 50% or more in the aggregate, from the Council of the EU's Best Practices of July 2024, with control criteria the panel asks the reviewer to check) and the UK test (one listed owner holding more than 50%; separate holdings are added up only under a joint arrangement, which the panel asks the reviewer to check). When none of those rules blocks the vendor, and for a listed director, the reviewer chooses to proceed or to block, with a reason.
- Jira setup in one click: a company-managed "Vendor onboarding" project whose Approve transition runs the app's `jira:workflowValidator`, "Sanctions review" and "Blocked" statuses, and a "Close without approval" transition. Work items created in the projects you choose are screened under their summary, the vendor's legal name, with the Vendor details field. A new vendor with a possible match moves to Sanctions review, and a vendor that a confirmed match blocks moves to Blocked.
- A Sanctions Hold panel in the work item's right sidebar with the vendor's status and each possible match, and a wider one from the work item's Apps button with the evidence side by side: name, country, date of birth and nationality where the list gives them, program or regime, aliases, addresses and the list's remarks. An owner's year of birth and nationality are marked "same" or "differs" against the list entry. The reviewer marks each possible match as the same party or not, with a reason that goes into the audit record and onto the work item as a comment.
- After each list update every vendor is screened again. An approved vendor with a new possible match moves back to Sanctions review and its work item gets a comment. A dismissed match comes back for review when its list entry changes.
- An accuracy test that runs inside the site on the lists as loaded.
- An audit record as CSV: screenings, possible matches, decisions with reasons, blocked approvals, approvals and list updates, each with the list version it used.
- Six MCP tools through the Atlassian MCP server: `screen-counterparty`, `request-approval`, `counterparty-status`, `match-evidence`, `add-review-note` and `list-changes`. See [skills/sanctions-hold/SKILL.md](skills/sanctions-hold/SKILL.md).
- A Sanctions Hold agent in Rovo with the same six actions, and the same instructions as a Rovo skill that other agents can add. Ask it about a supplier and it screens the company and owners, and opens the onboarding request in Jira when you want to go ahead. Start it from a work item's Agent sessions and it compares each match waiting for review with the owner's details, lists what the reviewer could ask for, and posts its notes as a comment once you confirm.

## Try it with the sample vendors

1. In Jira, open Apps → Sanctions Hold and select "Load the lists and the sample vendors". It takes about three minutes. The sample has 197 vendors, and seven of them have a possible match.
2. On the Overview, select "Create the project". It creates Vendor onboarding (VEND) with nine requests.
3. Open VEND-1 (Dexterus Global DMCC) and try the Approve transition. Jira blocks it and names the possible match. Open "Sanctions Hold" in the right sidebar to see the evidence and decide.
4. VEND-2: confirm the 60% owner and the vendor is blocked under OFAC's 50 Percent Rule and moves to Blocked. VEND-6: confirm both matches for the 20% owner and choose whether to proceed. VEND-7: the 60% owner is on the UK list only; confirm the match and the UK test blocks the vendor. VEND-9: the 30% and 25% owners are on the EU list only; confirm both and the EU rule, which adds up their 55%, blocks the vendor.
5. VEND-3 is close to an alias of an Iranian company; mark it "Not the same party" and it can be approved. VEND-4 has no match. On VEND-8 (Savannah Freight Ltd), select Start work → Sanctions Hold under Agent sessions: the agent compares the owner, born 1990 and Kenyan, with the two matched SDN entries and asks whether to post its review notes; select Confirm to add them as a comment.
6. The sample starts from the latest OFAC publication without its newest SDN designations. On the Overview, select "Replay them as a list update". VEND-5, approved two months earlier, is matched by one of those designations and moves to Sanctions review with a comment. The approved vendor Berkeley Trading LLC, which has no work item, goes back to review as well.
7. The Accuracy tab shows the held-out result. "Run the test on this site" runs about 13,000 searches in the background (about 25 minutes) and adds the site's result beside it when the run finishes.

To use the MCP tools on a site with Rovo, a site admin opens the site's Site settings in admin.atlassian.com → Connected apps → sanctions-hold → Details, and under "Expose tools to MCP-compatible apps" selects "Enable tools".

## Accuracy

`scripts/accuracy.mjs` draws 1,500 list entries and searches for each by its listed name, an alias and five kinds of variant. Recall is the share of those searches that find the entry. The false positive rates are the shares of real names not on the lists that are flagged: 3,400 company names from GLEIF LEI records (CC0) and 3,400 person names from Wikidata (CC0), 200 from each of 17 countries and territories, less the 9 company names and 8 person names whose words equal a listed name, which are counted apart. The matcher was tuned on other samples; these were measured with the OFAC lists updated 2026-11-23, the UK list updated 2026-11-24 and the EU list updated 2026-11-20:

| Threshold | Recall | Companies flagged | People flagged |
|---|---|---|---|
| 0.88 | 99.6% (6,050 of 6,077) | 0.8% (26 of 3,391) | 2.0% (67 of 3,392) |
| 0.90 | 99.6% (6,050 of 6,077) | 0.7% (24 of 3,391) | 1.9% (65 of 3,392) |
| 0.92 (default) | 99.5% (6,047 of 6,077) | 0.3% (11 of 3,391) | 1.8% (60 of 3,392) |
| 0.94 | 99.4% (6,041 of 6,077) | 0.2% (8 of 3,391) | 1.6% (54 of 3,392) |

Recall by kind at 0.92: listed name, alias, word order, legal suffix and one given name and surname 100%, one-letter typo 98.7%, transliteration 97.1%. Of the 60 people flagged, 50 differ from every list entry they matched in year of birth or nationality, which the review panel marks "differs".

```sh
scripts/fetch-ofac.sh /tmp/ofac
curl -o /tmp/UK-Sanctions-List.xml https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml
curl --compressed -o /tmp/eu.xml 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw'
UK=/tmp/UK-Sanctions-List.xml EU=/tmp/eu.xml PEOPLE=src/data/people-negatives.json SEED=11 node scripts/accuracy.mjs /tmp/ofac src/data/negatives.json 0.92
UK=/tmp/UK-Sanctions-List.xml EU=/tmp/eu.xml node scripts/sample-check.mjs /tmp/ofac     # which sample vendors match the current lists
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
| `src/core/ofac.js`, `src/core/uk.js`, `src/core/eu.js`, `src/core/records.js` | OFAC CSV, UK XML and EU XML parsing, and the change detection between versions |
| `src/core/decision.js` | Vendor status from possible matches, review decisions and the ownership rules |
| `src/core/owners.js` | Owners and directors with their shares |
| `src/core/accuracy.js` | The accuracy test shared by the script and the app |
| `src/backend/` | Forge SQL schema, list import, the in-memory index, screening, vendors, Jira setup, the Vendor details field |
| `src/frontend/` | UI Kit global page, issue panel and custom field |
| `src/validator.js` | Workflow validator for the Approve transition |
| `src/events.js` | Product event triggers for new and edited work items and approvals |
| `src/jobs.js` | Hourly list check and queue consumer |
| `src/actions.js` | MCP tools and Rovo actions |
| `skills/sanctions-hold/SKILL.md` | The Rovo skill, also the guide for MCP clients |
| `static/agent/prompt.txt` | The Rovo agent's instructions |
| `src/data/` | The company and person names used to measure false positives, and the offline result |

## Data and privacy

See [PRIVACY.md](PRIVACY.md). Support: [GitHub Issues](https://github.com/zzunkie/sanctions-hold/issues).

## Data sources and licences

- OFAC sanctions lists: U.S. Treasury, Office of Foreign Assets Control, public domain.
- UK Sanctions List: Foreign, Commonwealth and Development Office. Contains public sector information licensed under the Open Government Licence v3.0.
- EU consolidated list of persons, groups and entities subject to EU financial sanctions: European Commission, Financial Sanctions Files, reused under Commission Decision 2011/833/EU. Only the texts published in the Official Journal of the EU are authentic.
- GLEIF LEI records (CC0 1.0) and Wikidata (CC0 1.0), used only for the accuracy test.

## License

[MIT](LICENSE)
