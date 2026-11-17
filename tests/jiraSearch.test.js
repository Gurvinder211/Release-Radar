import assert from 'node:assert/strict';
import test from 'node:test';
import { searchJiraIssues } from '../src/jiraSearch.js';

const response = (result) => ({ json: async () => result });

test('follows Jira page tokens and combines results from all pages', async () => {
  const requests = [];
  const result = await searchJiraIssues({
    requestPage: async (body) => {
      requests.push(body);
      return requests.length === 1
        ? response({ issues: [{ key: 'PROJ-1' }], nextPageToken: 'next-page' })
        : response({ issues: [{ key: 'PROJ-2' }] });
    },
    jql: 'project = "PROJ"',
    fields: ['summary'],
    pageSize: 1,
    maxIssues: 5,
    maxPages: 5,
  });

  assert.deepEqual(result, {
    issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }],
    pagesRead: 2,
    truncated: false,
  });
  assert.equal(requests[1].nextPageToken, 'next-page');
});

test('marks analysis truncated when an issue or page limit leaves results unread', async () => {
  let calls = 0;
  const result = await searchJiraIssues({
    requestPage: async () => {
      calls += 1;
      return response({
        issues: [{ key: 'PROJ-1' }],
        nextPageToken: 'next-page',
      });
    },
    jql: 'project = "PROJ"',
    fields: ['summary'],
    pageSize: 1,
    maxIssues: 2,
    maxPages: 1,
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.pagesRead, 1);
  assert.equal(result.truncated, true);
  assert.equal(calls, 1);
});

test('fails explicitly when Jira repeats a pagination token', async () => {
  let calls = 0;
  await assert.rejects(
    searchJiraIssues({
      requestPage: async () => {
        calls += 1;
        return response({ issues: [{ key: `PROJ-${calls}` }], nextPageToken: 'same-token' });
      },
      jql: 'project = "PROJ"',
      fields: ['summary'],
      pageSize: 1,
      maxIssues: 5,
      maxPages: 5,
    }),
    /repeated search page token/,
  );
  assert.equal(calls, 2);
});
