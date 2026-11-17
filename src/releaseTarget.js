export function selectProjectVersion(versions, versionName) {
  if (!Array.isArray(versions)) {
    throw new Error('Jira returned an unexpected project-versions response.');
  }

  const matches = versions.filter((version) => version?.name === versionName);
  if (matches.length === 0) {
    throw new Error(
      'No Jira version exactly matches that name in this project. Check the project Releases page.',
    );
  }

  if (matches.length > 1) {
    throw new Error(
      'More than one Jira version matches that name. Use a unique version name for this project.',
    );
  }

  const [version] = matches;
  if (typeof version.id !== 'string' || !/^\d+$/.test(version.id)) {
    throw new Error('Jira returned a version without a valid ID; no risk report was generated.');
  }

  return version;
}

export function buildUnresolvedReleaseJql(projectKey, versionId) {
  if (typeof projectKey !== 'string' || !/^[A-Z][A-Z0-9_]{0,19}$/.test(projectKey)) {
    throw new Error('A valid Jira project key is required to build the release query.');
  }

  if (typeof versionId !== 'string' || !/^\d+$/.test(versionId)) {
    throw new Error('A valid Jira version ID is required to build the release query.');
  }

  return `project = "${projectKey}" AND fixVersion = ${versionId} AND resolution IS EMPTY ORDER BY priority DESC, updated ASC`;
}
