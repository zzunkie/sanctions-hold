# Sanctions Hold privacy policy

Last updated: 2026-11-26

Sanctions Hold is a Forge app for Jira Cloud. It runs on Atlassian's platform inside the Jira site where it is installed.

## What the app stores

- The OFAC sanctions lists as published by the U.S. Treasury and the UK Sanctions List as published by the UK Foreign, Commonwealth and Development Office: names, aliases, addresses, programs or regimes, dates of birth, nationalities and remarks of listed companies and people.
- Vendors that users add, import, create as Jira work items or request through the MCP tools: legal name, country, the names of owners and directors and the owners' shares that users enter, and the work item key. The same details are kept in the work item's Vendor details field in Jira.
- Possible matches and the decisions on them: the list entry, the score, the reviewer's Atlassian account ID, the time and the reason the reviewer wrote, and a reviewer's decision to proceed with or block a vendor that has a listed minority owner or director.
- A history of screenings, blocked and completed approvals (with the Atlassian account ID of the person who approved), list updates and screenings made through the MCP tools.
- App settings, such as the match threshold and the projects screened automatically.

This data is kept in Forge SQL for that site's installation.

## Outside services

The app downloads the public list files from the OFAC Sanctions List Service (`sanctionslistservice.ofac.treas.gov`, which redirects to its file storage at `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`) and from the UK Sanctions List (`sanctionslist.fcdo.gov.uk`). Screening runs inside the app. Vendor names, owner names and user data are not sent to any outside service.

The MCP tools return results to the MCP client that a user of the site has authorized through Atlassian.

## Removing data

A site admin can remove the sample vendors from the app's Settings tab. Uninstalling the app removes its stored data under Atlassian's Forge data retention rules.

## Contact

Open an issue at https://github.com/zzunkie/sanctions-hold/issues.
