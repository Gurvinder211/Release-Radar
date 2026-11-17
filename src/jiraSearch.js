export async function searchJiraIssues({
  requestPage,
  jql,
  fields,
  pageSize,
  maxIssues,
  maxPages,
}) {
  if (
    typeof requestPage !== 'function'
    || typeof jql !== 'string'
    || !Array.isArray(fields)
    || !Number.isInteger(pageSize)
    || pageSize < 1
    || !Number.isInteger(maxIssues)
    || maxIssues < 1
    || !Number.isInteger(maxPages)
    || maxPages < 1
  ) {
    throw new Error('A valid Jira search request and positive paging limits are required.');
  }

  const issues = [];
  const seenTokens = new Set();
  let nextPageToken;
  let pagesRead = 0;
  let truncated = false;

  while (pagesRead < maxPages) {
    const body = {
      jql,
      fields,
      maxResults: Math.min(pageSize, maxIssues - issues.length),
    };
    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    const response = await requestPage(body);
    const result = await response.json();
    if (!Array.isArray(result?.issues)) {
      throw new Error('Jira returned an unexpected issue-search response; no risk report was generated.');
    }

    pagesRead += 1;
    const remaining = maxIssues - issues.length;
    const pageIssues = result.issues.slice(0, remaining);
    issues.push(...pageIssues);

    const token = typeof result.nextPageToken === 'string' && result.nextPageToken
      ? result.nextPageToken
      : '';
    const pageOverflow = result.issues.length > remaining;
    const hasMore = Boolean(token) || result.isLast === false;

    if (issues.length >= maxIssues) {
      truncated = pageOverflow || hasMore;
      break;
    }

    if (!token) {
      if (result.isLast === false) {
        throw new Error('Jira indicated more search results but did not return a page token.');
      }
      break;
    }

    if (seenTokens.has(token)) {
      throw new Error('Jira returned a repeated search page token; analysis stopped to avoid duplicate results.');
    }
    seenTokens.add(token);
    nextPageToken = token;
  }

  if (pagesRead === maxPages && nextPageToken && issues.length < maxIssues) {
    truncated = true;
  }

  return { issues, pagesRead, truncated };
}
