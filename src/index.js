import api, { route } from '@forge/api';
import { summarizeReleaseRisk } from './releaseRisk.js';
import { buildUnresolvedReleaseJql, selectProjectVersion } from './releaseTarget.js';
import { searchJiraIssues } from './jiraSearch.js';

const MAX_ISSUES_PER_PAGE = 100;
const MAX_ANALYZED_ISSUES = 2000;
const MAX_SEARCH_PAGES = 20;
const ISSUE_FIELDS = ['summary', 'status', 'priority', 'assignee', 'updated', 'duedate', 'issuelinks'];

export async function analyzeReleaseReadiness(payload, context) {
  const projectKey = typeof payload?.projectKey === 'string'
    ? payload.projectKey.trim().toUpperCase()
    : '';
  const versionName = typeof payload?.versionName === 'string'
    ? payload.versionName.trim()
    : '';

  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(projectKey)) {
    throw new Error('Provide a valid Jira project key, for example DESIGN.');
  }

  if (!versionName || versionName.length > 255) {
    throw new Error('Provide the exact Jira version name (1 to 255 characters).');
  }

  if (!context?.principal?.accountId) {
    throw new Error('This action requires an authenticated Jira user.');
  }

  const jira = api.asUser();
  const projectResponse = await jira.requestJira(route`/rest/api/3/project/${projectKey}`, {
    headers: { Accept: 'application/json' },
  });

  if (!projectResponse.ok) {
    throw new Error(
      `Could not access Jira project ${projectKey} (HTTP ${projectResponse.status}). `
      + 'Check the project key and your Browse Projects permission.',
    );
  }

  const project = await projectResponse.json();
  if (typeof project?.id !== 'string' || typeof project?.key !== 'string') {
    throw new Error('Jira returned incomplete project details; no risk report was generated.');
  }

  const versionsResponse = await jira.requestJira(
    route`/rest/api/3/project/${project.key}/versions`,
    { headers: { Accept: 'application/json' } },
  );

  if (!versionsResponse.ok) {
    throw new Error(
      `Could not load Jira versions for project ${project.key} (HTTP ${versionsResponse.status}).`,
    );
  }

  const versions = await versionsResponse.json();
  const targetVersion = selectProjectVersion(versions, versionName);
  const jql = buildUnresolvedReleaseJql(project.key, targetVersion.id);
  const search = await searchJiraIssues({
    requestPage: async (body) => {
      const response = await jira.requestJira(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(
          `Jira issue search failed for project ${project.key} (HTTP ${response.status}).`,
        );
      }

      return response;
    },
    jql,
    fields: ISSUE_FIELDS,
    pageSize: MAX_ISSUES_PER_PAGE,
    maxIssues: MAX_ANALYZED_ISSUES,
    maxPages: MAX_SEARCH_PAGES,
  });

  const targetVersionSummary = {
    name: targetVersion.name,
    releaseDate: typeof targetVersion.releaseDate === 'string'
      ? targetVersion.releaseDate
      : null,
    released: typeof targetVersion.released === 'boolean' ? targetVersion.released : null,
    overdue: typeof targetVersion.overdue === 'boolean' ? targetVersion.overdue : null,
  };

  return {
    project: {
      key: project.key,
      name: typeof project.name === 'string' ? project.name : project.key,
    },
    targetVersion: targetVersionSummary,
    analyzed: search.issues.length,
    pagesRead: search.pagesRead,
    truncated: search.truncated,
    ...summarizeReleaseRisk(search.issues, {
      releaseDate: targetVersionSummary.releaseDate,
      released: targetVersionSummary.released === true,
    }),
    note: 'Read-only snapshot. Per-issue scores are weighted heuristics, not predictions.',
  };
}
