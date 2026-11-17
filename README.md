# Release-Radar

Release-Radar is an Atlassian Forge Rovo Agent that helps teams assess Jira
release readiness. It analyzes unresolved issues for a user-specified project
and exact version, highlights risk signals, and recommends next steps.

The analysis is read-only. Scores are transparent, weighted heuristics for
triage—not predictions of release success.

## What it analyzes

For each matching issue, Release-Radar considers:

| Signal | Points |
| --- | ---: |
| Blocked status | 45 |
| Blocker priority | 40 |
| Critical or highest priority | 35 |
| High priority | 25 |
| Overdue due date | 30 |
| Unresolved upstream blocker | 25 |
| Unreleased target date passed | 25 |
| Unreleased target date within 7 days | 15 |
| Unassigned | 10 |
| No update in more than 14 days | 10 |

Signals are additive, and each issue's score is capped at 100. Risk bands are:

| Band | Score |
| --- | ---: |
| Critical | 70–100 |
| High | 40–69 |
| Elevated | 20–39 |
| Watch | 1–19 |
| Clear | 0 |

The report includes risk indicators, up to five highest-risk issues, reasons
and suggested actions. It also distinguishes linked blockers in the analyzed
issue set from those not returned by the search; an absent issue is not
assumed to be outside the target release.

The search analyzes up to 2,000 issues across at most 20 pages. The report
indicates when results are truncated.

## Technology

- JavaScript (ES modules), running on Node.js 24
- Atlassian Forge and a Jira Rovo Agent
- Jira Cloud REST API v3 via Forge's `@forge/api`, using the authenticated user
- Jira `read:jira-work` scope
- No separate database or direct Claude/Anthropic integration

## Run tests

Install dependencies and run the test suite:

```sh
npm install
npm test
```

## Deploying with Forge

Install and authenticate the [Forge CLI](https://developer.atlassian.com/platform/forge/cli-reference/),
then run these commands from the project root:

```sh
forge deploy --non-interactive --e development
forge install --non-interactive --site <your-site>.atlassian.net --product jira --environment development
```

The Jira project and exact version are supplied to the Rovo Agent when
requesting an assessment. The user must have permission to browse the project
and its issues.
