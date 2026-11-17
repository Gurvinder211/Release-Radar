const HIGH_PRIORITIES = new Set(['blocker', 'critical', 'high', 'highest']);
const RESOLVED_STATUS_NAMES = new Set(['cancelled', 'canceled', 'closed', 'complete', 'completed', 'done', 'resolved']);
const STALE_AFTER_DAYS = 14;
const RELEASE_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const RISK_POINTS = {
  blocked: 45,
  blockerPriority: 40,
  criticalPriority: 35,
  highPriority: 25,
  overdueIssue: 30,
  unassigned: 10,
  stale: 10,
  dependencyBlocker: 25,
  releaseSoon: 15,
  releaseOverdue: 25,
};
const RISK_BANDS = {
  critical: '70-100',
  high: '40-69',
  elevated: '20-39',
  watch: '1-19',
  clear: '0',
};

function daysUntilRelease(releaseDate, today) {
  if (typeof releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    return null;
  }

  const releaseTimestamp = Date.parse(`${releaseDate}T00:00:00.000Z`);
  const todayTimestamp = Date.parse(`${today}T00:00:00.000Z`);
  if (
    !Number.isFinite(releaseTimestamp)
    || new Date(releaseTimestamp).toISOString().slice(0, 10) !== releaseDate
  ) {
    return null;
  }

  return Math.round((releaseTimestamp - todayTimestamp) / DAY_MS);
}

function getRiskLevel(score) {
  if (score >= 70) {
    return 'critical';
  }
  if (score >= 40) {
    return 'high';
  }
  if (score >= 20) {
    return 'elevated';
  }
  if (score > 0) {
    return 'watch';
  }
  return 'clear';
}

function getUnresolvedBlockers(issueLinks, releaseIssueKeys) {
  if (!Array.isArray(issueLinks)) {
    return [];
  }

  const blockers = new Map();
  for (const link of issueLinks) {
    const linkedIssue = link?.inwardIssue || link?.outwardIssue;
    const linkLabel = link?.inwardIssue
      ? link.type?.inward
      : link?.outwardIssue
        ? link.type?.outward
        : '';
    if (
      typeof linkLabel !== 'string'
      || !/(blocked by|depends on)/i.test(linkLabel)
      || typeof linkedIssue?.key !== 'string'
    ) {
      continue;
    }

    const status = linkedIssue.fields?.status;
    const statusName = typeof status?.name === 'string' ? status.name : '';
    const statusCategory = typeof status?.statusCategory?.key === 'string'
      ? status.statusCategory.key.toLowerCase()
      : '';
    if (
      !statusName
      || statusCategory === 'done'
      || RESOLVED_STATUS_NAMES.has(statusName.toLowerCase())
    ) {
      continue;
    }

    blockers.set(linkedIssue.key, {
      key: linkedIssue.key,
      summary: typeof linkedIssue.fields?.summary === 'string' ? linkedIssue.fields.summary : '',
      status: statusName,
      inAnalyzedSet: releaseIssueKeys.has(linkedIssue.key),
    });
  }

  return [...blockers.values()];
}

export function summarizeReleaseRisk(issues, { now = new Date(), releaseDate = null, released = false } = {}) {
  const today = now.toISOString().slice(0, 10);
  const staleBefore = now.getTime() - STALE_AFTER_DAYS * DAY_MS;
  const releaseDaysRemaining = daysUntilRelease(releaseDate, today);
  const releaseIssueKeys = new Set(
    issues.filter((issue) => typeof issue?.key === 'string').map((issue) => issue.key),
  );
  const indicators = {
    blocked: 0,
    highPriority: 0,
    overdue: 0,
    unassigned: 0,
    stale: 0,
    dependencyBlocked: 0,
    dependencyOutsideAnalyzedSet: 0,
    releaseDatePressure: 0,
  };
  const riskDistribution = {
    critical: 0,
    high: 0,
    elevated: 0,
    watch: 0,
    clear: 0,
  };

  const flaggedIssues = issues.map((issue) => {
    if (typeof issue?.key !== 'string' || !issue.fields || typeof issue.fields !== 'object') {
      throw new Error('Jira returned an issue without its required key or fields.');
    }

    const fields = issue.fields;
    const reasons = [];
    const status = typeof fields.status?.name === 'string' ? fields.status.name : '';
    const priority = typeof fields.priority?.name === 'string'
      ? fields.priority.name.toLowerCase()
      : '';
    const dueDate = typeof fields.duedate === 'string' ? fields.duedate : '';
    const updatedAt = typeof fields.updated === 'string' ? Date.parse(fields.updated) : NaN;
    const blockingIssues = getUnresolvedBlockers(fields.issuelinks, releaseIssueKeys);
    let riskScore = 0;
    const nextSteps = [];

    if (status.toLowerCase().includes('block')) {
      indicators.blocked += 1;
      riskScore += RISK_POINTS.blocked;
      reasons.push('Blocked status');
      nextSteps.push('Identify and clear the blocker or document an explicit release exception.');
    }

    if (HIGH_PRIORITIES.has(priority)) {
      indicators.highPriority += 1;
      reasons.push(`High priority (${fields.priority.name})`);
      nextSteps.push('Confirm release scope and acceptance criteria with the release owner.');
      if (priority === 'blocker') {
        riskScore += RISK_POINTS.blockerPriority;
      } else if (priority === 'critical' || priority === 'highest') {
        riskScore += RISK_POINTS.criticalPriority;
      } else {
        riskScore += RISK_POINTS.highPriority;
      }
    }

    if (dueDate && dueDate < today) {
      indicators.overdue += 1;
      riskScore += RISK_POINTS.overdueIssue;
      reasons.push(`Overdue since ${dueDate}`);
      nextSteps.push('Replan the overdue date or confirm a recovery plan.');
    }

    if (!fields.assignee) {
      indicators.unassigned += 1;
      riskScore += RISK_POINTS.unassigned;
      reasons.push('Unassigned');
      nextSteps.push('Assign an accountable owner for this release item.');
    }

    if (Number.isFinite(updatedAt) && updatedAt < staleBefore) {
      indicators.stale += 1;
      riskScore += RISK_POINTS.stale;
      reasons.push(`No update in more than ${STALE_AFTER_DAYS} days`);
      nextSteps.push('Get a current status and next milestone from the owner.');
    }

    if (blockingIssues.length > 0) {
      indicators.dependencyBlocked += 1;
      riskScore += RISK_POINTS.dependencyBlocker;

      const outsideAnalyzedSet = blockingIssues.filter((blocker) => !blocker.inAnalyzedSet);
      if (outsideAnalyzedSet.length > 0) {
        indicators.dependencyOutsideAnalyzedSet += 1;
      }

      const blockerKeys = blockingIssues.slice(0, 3).map((blocker) => blocker.key).join(', ');
      const omittedCount = blockingIssues.length - Math.min(blockingIssues.length, 3);
      const releaseLocation = outsideAnalyzedSet.length === 0
        ? 'all present in the analyzed set'
        : `${outsideAnalyzedSet.length} not present in the analyzed set`;
      reasons.push(
        `Has ${blockingIssues.length} unresolved upstream blocker(s), ${releaseLocation}: `
        + `${blockerKeys}${omittedCount > 0 ? ` (+${omittedCount} more)` : ''}`,
      );
      nextSteps.push(
        outsideAnalyzedSet.length > 0
          ? 'Verify whether linked issues not present in the analyzed set belong to this version, then coordinate owners on an unblock or workaround.'
          : 'Resolve the linked blocker and re-sequence dependent work.',
      );
    }

    if (!released && releaseDaysRemaining !== null && releaseDaysRemaining < 0) {
      indicators.releaseDatePressure += 1;
      riskScore += RISK_POINTS.releaseOverdue;
      reasons.push(`Target release date passed ${Math.abs(releaseDaysRemaining)} days ago`);
      nextSteps.push('Escalate the release date and agree on a recovery plan.');
    } else if (
      !released
      && releaseDaysRemaining !== null
      && releaseDaysRemaining <= RELEASE_SOON_DAYS
    ) {
      indicators.releaseDatePressure += 1;
      riskScore += RISK_POINTS.releaseSoon;
      const dayLabel = releaseDaysRemaining === 1 ? 'day' : 'days';
      reasons.push(`Target release date in ${releaseDaysRemaining} ${dayLabel}`);
      nextSteps.push('Confirm the remaining work fits the target release date.');
    }

    riskScore = Math.min(riskScore, 100);
    const riskLevel = getRiskLevel(riskScore);
    riskDistribution[riskLevel] += 1;

    return {
      key: issue.key,
      summary: typeof fields.summary === 'string' ? fields.summary : '',
      updatedAt,
      riskScore,
      riskLevel,
      reasons,
      nextSteps,
      blockingIssueCount: blockingIssues.length,
      blockingIssues: blockingIssues.slice(0, 5),
    };
  });

  const highestRisk = flaggedIssues
    .filter((issue) => issue.riskScore > 0)
    .sort((a, b) => {
      const scoreDifference = b.riskScore - a.riskScore;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      const signalDifference = b.reasons.length - a.reasons.length;
      if (signalDifference !== 0) {
        return signalDifference;
      }

      const aUpdated = Number.isFinite(a.updatedAt) ? a.updatedAt : Number.POSITIVE_INFINITY;
      const bUpdated = Number.isFinite(b.updatedAt) ? b.updatedAt : Number.POSITIVE_INFINITY;
      return aUpdated - bUpdated || a.key.localeCompare(b.key);
    })
    .slice(0, 5)
    .map(({
      key,
      summary,
      riskScore,
      riskLevel,
      reasons,
      nextSteps,
      blockingIssueCount,
      blockingIssues,
    }) => ({
      key,
      summary,
      riskScore,
      riskLevel,
      reasons,
      nextSteps,
      blockingIssueCount,
      blockingIssues,
    }));

  return {
    indicators,
    riskDistribution,
    scoring: {
      bands: RISK_BANDS,
      points: RISK_POINTS,
      note: 'Signals are additive, capped at 100 per issue, and indicate triage urgency rather than release success probability.',
    },
    highestRisk,
  };
}
