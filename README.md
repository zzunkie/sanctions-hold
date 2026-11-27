# Sanctions Hold

Sanctions Hold is a Forge app for Jira Cloud that screens vendors, owners and directors against the U.S. Treasury OFAC sanctions lists, the UK Sanctions List and the EU Consolidated Financial Sanctions List. Jira holds a vendor's approval while a possible match waits for review or a confirmed match blocks the vendor, and every vendor is screened again when a list changes.

Built for Atlassian Codegeist 2026 (Apps for Business Teams; bonus: Best app with Atlassian MCP, Best Agents - Rovo/Assignable agents).

## Features

- Lists: the OFAC SDN List and Consolidated Sanctions List from the OFAC Sanctions List Service, the asset-freeze designations on the FCDO's UK Sanctions List, and the European Commission's consolidated list of persons, groups and entities subject to EU financial sanctions: about 30,000 company and individual entries with over 48,000 aliases. The app checks all three sources every hour and records each update entry by entry.
- A "Vendor details" custom field on the create screen and the work item: country of registration, registered address, registration or license number, owners with their share, year of birth and nationality, and directors.
- CSV import on the Vendors tab for the vendors you already work with (name, country, owners and directors, plus optional address, registration number and approval date). Imported vendors count as approved; if one matches a list entry at import or after a later list update, the app opens a work item in the onboarding project. See [examples/current-vendors.csv](examples/current-vendors.csv).
- Name matching for the company and each owner and director: aliases, one-letter typos, transliterations (Mohammad and Muhammad), first-name-first word order, legal suffixes, and a listed person searched by one given name and surname when the list also has middle names or a patronymic. Each word is weighted by how rare it is on the lists.
- Ownership rules from the list that names a confirmed owner: OFAC's 50 Percent Rule (listed owners holding 50% or more in the aggregate), the EU rule (listed owners holding 50% or more in the aggregate, from the Council of the EU's Best Practices of July 2024, with control criteria the panel asks the reviewer to check) and the UK test (one listed owner holding more than 50%; separate holdings are added up only under a joint arrangement, which the panel asks the reviewer to check). When none of those rules blocks the vendor, and for a listed director, the reviewer chooses to proceed or to block, with a reason.
- Jira setup in one click: a company-managed "Vendor onboarding" project whose Approve transition runs the app's `jira:workflowValidator`, "Sanctions review" and "Blocked" statuses, and a "Close without approval" transition. Work items created in the projects you choose are screened under their summary, the vendor's legal name, with the Vendor details field. A new vendor with a possible match moves to Sanctions review, and a vendor that a confirmed match blocks moves to Blocked.
- Two Sanctions Hold panels: a summary in the right sidebar with the vendor's status and a short summary of each possible match, and a panel in the main column, which the app opens on each work item it holds (it can also be added from View app actions under the title). Reviewers decide there with the evidence side by side: name, country, date of birth and nationality where the list gives them, program or regime, aliases, addresses and the list's remarks. For a company, its registered address and registration or license number sit next to the entry's addresses and the registration, tax and license numbers in the list's remarks. A company's country and registration number, and an owner's year of birth and nationality, are marked "same" or "differs" when both sides give a value. The Review queue lists the open matches of all vendors with how each was found and the short comparison. The reviewer marks each possible match as the same party or not, with a reason that goes into the audit record and onto the work item as a comment, and can reopen a decision later; the audit record keeps both.
- Search by registration number: a list entry that gives the vendor's registration, license or tax number is a possible match under any name, when the number is registered in the vendor's country (the country written next to the number on the entry, or else one of the entry's countries). Numbers are compared without spaces or punctuation, and numbers shorter than six characters are not indexed.
- Settings, changed by Jira admins. With a Jira group chosen, only its members decide possible matches and listed minority owners or directors; everyone else sees the evidence.
- An optional year-of-birth rule in Settings (off by default): when both the vendor record and the list entry give a birth year and the owner's or director's year is more than one year from every date of birth on the entry, the possible match is cleared. Because the lists sometimes record different years of birth for the same person, a match stays open if another matched entry with the same primary name gives no date of birth or a year within one year of theirs. A range of years on the entry counts as every year in it, and a circa year as two years either side. Both years are recorded in the audit record, on the panel and in a comment on the work item. Matches a reviewer has decided are left as they are, and a match whose entry gives no date of birth is never cleared (91% of the people on the three lists, 14,758 of 16,268, have one). Screening through the Rovo agent and the MCP tools applies the same rule, and the Review queue lists every match the rule cleared so a reviewer can open one and mark it as the same person if the year of birth on the record is wrong.
- After each list update every vendor is screened again. An approved vendor with a new possible match moves back to Sanctions review and its work item gets a comment; an approved vendor without a work item gets one in the onboarding project. A dismissed match comes back for review when its list entry changes.
- Payment holds: the setup creates an Accounts payable project (Settings → "Payment holds" can point to another project). An approved vendor matched by a list update, an import or a change in the screening settings gets a "Hold payments to …" work item there, assigned to the project lead and linked to the vendor's work item. When the reviewer clears the vendor, the app comments that payments can resume and moves the hold to Done; when the vendor is blocked, it comments that payments stay on hold and leaves the hold open. If a reviewer reopens a cleared vendor's review, the app moves the hold back to To Do and comments that payments should be held again.
- An accuracy test that runs inside the site on the lists as loaded, split into parts that run at the same time on the queue.
- An audit record exported as CSV, one row per event: screenings, possible matches, decisions with reasons, blocked approvals, approvals, list updates and changes to the reviewer group. Screening, decision, blocked-approval and approval rows carry the list version they used.
- Six MCP tools through the Atlassian MCP server: `screen-counterparty`, `request-approval`, `counterparty-status`, `match-evidence`, `add-review-note` and `list-changes`. See [skills/sanctions-hold/SKILL.md](skills/sanctions-hold/SKILL.md).
- A Sanctions Hold agent in Rovo with the same six actions, and the same instructions as a Rovo skill that other agents can add. Ask it about a supplier and it screens the company and owners, and opens the onboarding request in Jira when you want to go ahead. Start it from a work item's Agent sessions and it compares each match waiting for review with the vendor's or owner's record and with the work item's description, comments and attachment names, names the document that would settle the match, and posts its notes as a comment once you confirm.

## Try it with the sample vendors

1. In Jira, open Apps → Sanctions Hold and select "Load the lists and the sample vendors". It takes about three minutes. The sample has 197 vendors, and eight of them have a possible match.
2. On the Overview, select "Create the project". It creates Vendor onboarding (VEND) with ten requests, and Accounts payable (AP) for payment holds.
3. Open VEND-1 (Dexterus Global DMCC) and try the Approve transition. Jira blocks it and names the possible match. The right sidebar shows the match, and the Sanctions Hold panel in the main column shows the evidence side by side for the decision.
4. VEND-2: confirm the 60% owner and the vendor is blocked under OFAC's 50 Percent Rule and moves to Blocked. VEND-6: confirm both matches for the 20% owner and choose whether to proceed. VEND-7: the 60% owner is on the UK list only; confirm the match and the UK test blocks the vendor. VEND-9: the 30% and 25% owners are on the EU list only; confirm both and the EU rule, which adds up their 55%, blocks the vendor.
5. VEND-3 is close to an alias of an Iranian company; mark it "Not the same party" and it can be approved. VEND-4 has no match. VEND-10 (Coastline Auto Spares Trading LLC) matches no list name, but its license number 510808 is the one the SDN entry for INTEGRATED AUTO PARTS LLC gives, so it waits in Sanctions review. On VEND-8 (Savannah Freight Ltd), on a site with Rovo, select Start work → Sanctions Hold under Agent sessions: the agent compares the Kenyan owner (born 1990) and the passport and birth details in the work item's description with the two matched SDN entries, then asks whether to post its review notes; select Confirm to add them as a comment. Mark both matches "Not the same person" and Approve goes through.
6. The sample starts from the latest OFAC publication without its newest SDN designations. On the Overview, select "Replay them as a list update". VEND-5, approved two months earlier, is matched by one of those designations and moves to Sanctions review with a comment. The approved vendor Berkeley Trading LLC had no work item, so the app opens one for its review. Accounts payable gets a "Hold payments to …" work item for each. While the sample holds these designations back, the hourly check waits for this replay, which loads the latest version of all three lists.
7. On the Vendors tab, import [examples/current-vendors.csv](examples/current-vendors.csv) (six suppliers approved in earlier years). Arconic SMZ JSC has no name match and is found by its registration number on the SDN entry for JOINT STOCK COMPANY SAMARA METALLURGICAL PLANT. Kamensk-Uralsky Metallurgical Works JSC matches an alias on an SDN entry that also gives its registration number. Tana River Logistics Ltd's owner Yusuf Ibrahim (born 1990) matches the same two SDN entries as on VEND-8. Each of the three gets a work item in Sanctions review and a payment hold in Accounts payable. On Tana River's work item, mark both matches "Not the same person"; Approve then goes through on that work item, and its payment hold in Accounts payable gets a comment that payments can resume and moves to Done.
8. The Accuracy tab shows the held-out result. "Run the test on this site" runs about 13,000 searches in the background (about four minutes on the demo site) and adds the site's result beside it.
9. In Settings, set "Year of birth" to On, then create a work item "Mombasa Coastal Freight Ltd" with Kenya and the owner Yusuf Ibrahim, 100%, born 1990, nationality Kenya. The rule clears the match with EBRAHIMI, Yousef (born 1977), posts a comment and lists it in the Review queue under "Cleared by the year-of-birth rule"; IBRAHIM, Aadan Yusuf Saciid stays open, because one of the entry's years of birth, 1989, is within a year of 1990.

To use the MCP tools on a site with Rovo, a site admin opens the site's Site settings in admin.atlassian.com → Connected apps → sanctions-hold → Details, and under "Expose tools to MCP-compatible apps" selects "Enable tools". [examples/mcp-agent](examples/mcp-agent) is a command-line agent that takes one request in plain language, follows SKILL.md and calls the tools through the Atlassian MCP server.

## List import

Each source shows whether it changed without a full download. The OFAC export URLs redirect to a storage path that carries the publication id, and SDN.CSV answers HEAD with its modification time; the UK file answers HEAD with an ETag; the EU's public RSS feed gives each file's publication time and SHA-1 checksum. The hourly check compares each source's version with the one it imported and skips a source whose version could not be read that hour, so a failed HEAD request or an unreachable feed does not start a full import.

When a source changes, the importer downloads the OFAC CSV exports (SDN and Consolidated, each with its alias and address files), the 22 MB UK XML file and the 26 MB EU XML file (3.4 MB with gzip). It writes each person as "SURNAME, Given names" to match OFAC. The EU file repeats each name in the spelling of several EU languages and scripts; the importer keeps the Latin-script spellings, which every EU entry has, and drops repeats, which leaves 24,149 names for 6,303 entries. Each entry is fingerprinted and only the changed rows are written to Forge SQL, with a row per added, removed or changed entry for the List updates tab. A download that fails with a server error is tried again twice. Loading the three lists and screening the 197 sample vendors takes about three minutes in the queue. Re-screening runs on the queue in batches of 1,000, one after another, each within the consumer's 15-minute limit. On the demo site, re-screening all 205 vendors on record (the 197 sample vendors plus eight added in testing) after a list update took 24 seconds.

## Accuracy

`scripts/accuracy.mjs` draws 1,500 list entries and searches for each by its listed name, an alias and five kinds of variant. Recall is the share of those searches that find the entry. The false positive rates are the shares of real names not on the lists that are flagged: 3,400 company names from GLEIF LEI records (CC0) and 3,400 person names from Wikidata (CC0), 200 from each of 17 countries and territories, less the 9 company names and 8 person names whose words equal a listed name, which are counted apart. The matcher was tuned on other samples; these were measured with the OFAC lists updated 2026-11-23, the UK list updated 2026-11-24 and the EU list updated 2026-11-20:

| Threshold | Recall | Companies flagged | People flagged |
|---|---|---|---|
| 0.88 | 99.6% (6,050 of 6,077) | 0.8% (26 of 3,391) | 2.0% (67 of 3,392) |
| 0.90 | 99.6% (6,050 of 6,077) | 0.7% (24 of 3,391) | 1.9% (65 of 3,392) |
| 0.92 (default) | 99.5% (6,047 of 6,077) | 0.3% (11 of 3,391) | 1.8% (60 of 3,392) |
| 0.94 | 99.4% (6,041 of 6,077) | 0.2% (8 of 3,391) | 1.6% (54 of 3,392) |

Recall by kind at 0.92: listed name, alias, word order, legal suffix and one given name and surname 100%, one-letter typo 98.7%, transliteration 97.1%. Of the 60 people flagged, 50 differ from every list entry they matched in year of birth or nationality, which the review panel marks "differs". The person names carry their year of birth from Wikidata; with the year-of-birth rule on, 15 of the 3,392 stay flagged (0.4%), including 8 of 198 from the UAE.

Registration numbers: all 14,034 numbers of six characters or more on company and organisation entries find their entry when searched with the country given for each. Searched by the registration number in their GLEIF LEI record, none of 10,809 companies (1,846 in Russia and 8,963 in 16 other countries and territories) matched another company's entry. Of the 1,846 Russian companies with an LEI and a number, 217 are on a list by their OGRN; for 40 of them neither the legal name nor any other name in the GLEIF record reaches 0.92, among them Drive Click Bank (listed by OFAC as Setelem Bank) and Bank PSB (listed as Promsvyazbank).

Year-of-birth rule across lists (OFAC lists of 2026-11-23, UK and EU lists of 2026-11-26): when two of the three sources each list one person under the same primary name, `scripts/yob-cross.mjs` takes a single year of birth on the first entry as an owner's and screens that owner against all three lists with the rule on, as the app does, giving 6,969 checks where the second entry also gives a year of birth. In 97 of them every year on the second entry is more than one year from the owner's, 28 with the same day and month of birth. Because the first entry has the same primary name and the owner's year, the rule leaves all 97 second entries open, so each list's ownership rule can count the person once the reviewer confirms both entries.

```sh
scripts/fetch-ofac.sh /tmp/ofac
curl -o /tmp/UK-Sanctions-List.xml https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml
curl --compressed -o /tmp/eu.xml 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw'
UK=/tmp/UK-Sanctions-List.xml EU=/tmp/eu.xml PEOPLE=src/data/people-negatives.json SEED=11 node scripts/accuracy.mjs /tmp/ofac src/data/negatives.json 0.92
UK=/tmp/UK-Sanctions-List.xml EU=/tmp/eu.xml node scripts/sample-check.mjs /tmp/ofac     # which sample vendors match the current lists
node scripts/fetch-gleif-country.mjs RU /tmp/gleif-RU.json; node scripts/fetch-gleif-regids.mjs 7 /tmp/gleif-p7.json
node scripts/regid-search.mjs /tmp/ofac /tmp/UK-Sanctions-List.xml /tmp/eu.xml /tmp/gleif-p7.json /tmp/gleif-RU.json
node scripts/yob-cross.mjs /tmp/ofac /tmp/UK-Sanctions-List.xml /tmp/eu.xml
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
| `examples/mcp-agent/` | A command-line agent that uses the MCP tools with SKILL.md as its instructions |
| `examples/current-vendors.csv` | A sample CSV of current vendors for the import on the Vendors tab |
| `static/agent/prompt.txt` | The Rovo agent's instructions |
| `src/data/` | The company and person names used to measure false positives, and the offline result |
| `scripts/` | The accuracy test, the sample check, the registration-number and cross-list year-of-birth measurements, and the GLEIF downloads they use |

## Data and privacy

See [PRIVACY.md](PRIVACY.md). Support: [GitHub Issues](https://github.com/zzunkie/sanctions-hold/issues).

## Data sources and licences

- OFAC sanctions lists: U.S. Treasury, Office of Foreign Assets Control, public domain.
- UK Sanctions List: Foreign, Commonwealth and Development Office. Contains public sector information licensed under the Open Government Licence v3.0.
- EU consolidated list of persons, groups and entities subject to EU financial sanctions: European Commission, Financial Sanctions Files, reused under Commission Decision 2011/833/EU. Only the texts published in the Official Journal of the EU are authentic.
- GLEIF LEI records (CC0 1.0) and Wikidata (CC0 1.0), used only for the accuracy test.

## License

[MIT](LICENSE)
