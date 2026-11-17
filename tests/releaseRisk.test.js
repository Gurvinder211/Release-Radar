import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeReleaseRisk } from '../src/releaseRisk.js';

const NOW = new Date('2026-11-15T12:00:00.000Z');

test('counts risk signals and returns the highest-risk issues without assignee details', () => {
  const result = summarizeReleaseRisk([
    {
      key: 'DESIGN-1',
      fields: {
        summary: 'Blocked payment flow',
        status: { name: 'Blocked' },
        priority: { name: 'Highest' },
        assignee: null,
        duedate: '2026-11-10',
        updated: '2026-10-01T10:00:00.000Z',
      },
    },
    {
      key: 'DESIGN-2',
      fields: {
        summary: 'Update docs',
        status: { name: 'In Progress' },
        priority: { name: 'Medium' },
        assignee: { accountId: 'private-id' },
        duedate: '2026-11-20',
        updated: '2026-11-14T10:00:00.000Z',
      },
    },
  ], { now: NOW });

  assert.deepEqual(result.indicators, {
    blocked: 1,
    highPriority: 1,
    overdue: 1,
    unassigned: 1,
    stale: 1,
    dependencyBlocked: 0,
    dependencyOutsideAnalyzedSet: 0,
    releaseDatePressure: 0,
  });
  assert.deepEqual(result.riskDistribution, {
    critical: 1,
    high: 0,
    elevated: 0,
    watch: 0,
    clear: 1,
  });
  assert.deepEqual(result.highestRisk, [{
    key: 'DESIGN-1',
    summary: 'Blocked payment flow',
    riskScore: 100,
    riskLevel: 'critical',
    reasons: [
      'Blocked status',
      'High priority (Highest)',
      'Overdue since 2026-11-10',
      'Unassigned',
      'No update in more than 14 days',
    ],
    nextSteps: [
      'Identify and clear the blocker or document an explicit release exception.',
      'Confirm release scope and acceptance criteria with the release owner.',
      'Replan the overdue date or confirm a recovery plan.',
      'Assign an accountable owner for this release item.',
      'Get a current status and next milestone from the owner.',
    ],
    blockingIssueCount: 0,
    blockingIssues: [],
  }]);
  assert.equal(JSON.stringify(result).includes('private-id'), false);
});

test('returns zeroed indicators for an empty project result', () => {
  const result = summarizeReleaseRisk([], { now: NOW });

  assert.deepEqual(result.indicators, {
    blocked: 0,
    highPriority: 0,
    overdue: 0,
    unassigned: 0,
    stale: 0,
    dependencyBlocked: 0,
    dependencyOutsideAnalyzedSet: 0,
    releaseDatePressure: 0,
  });
  assert.deepEqual(result.riskDistribution, {
    critical: 0,
    high: 0,
    elevated: 0,
    watch: 0,
    clear: 0,
  });
  assert.deepEqual(result.highestRisk, []);
});

test('ranks critical and high-priority stale issues into distinct risk bands', () => {
  const result = summarizeReleaseRisk([
    {
      key: 'PROJ-1',
      fields: {
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { accountId: 'owner' },
        updated: '2026-10-01T10:00:00.000Z',
      },
    },
    {
      key: 'PROJ-2',
      fields: {
        status: { name: 'In Progress' },
        priority: { name: 'Critical' },
        assignee: { accountId: 'owner' },
        updated: '2026-10-01T10:00:00.000Z',
      },
    },
  ], { now: NOW });

  assert.deepEqual(result.riskDistribution, {
    critical: 0,
    high: 1,
    elevated: 1,
    watch: 0,
    clear: 0,
  });
  assert.equal(result.highestRisk[0].key, 'PROJ-2');
  assert.equal(result.highestRisk[0].riskScore, 45);
  assert.equal(result.highestRisk[1].riskScore, 35);
});

test('release-date pressure increases urgency only for unreleased versions', () => {
  const issue = [{
    key: 'PROJ-3',
    fields: {
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: { accountId: 'owner' },
      updated: '2026-11-14T10:00:00.000Z',
    },
  }];
  const upcoming = summarizeReleaseRisk(issue, {
    now: NOW,
    releaseDate: '2026-11-20',
    released: false,
  });
  const alreadyReleased = summarizeReleaseRisk(issue, {
    now: NOW,
    releaseDate: '2026-11-20',
    released: true,
  });

  assert.equal(upcoming.highestRisk[0].riskScore, 40);
  assert.equal(upcoming.highestRisk[0].riskLevel, 'high');
  assert.equal(upcoming.indicators.releaseDatePressure, 1);
  assert.equal(alreadyReleased.highestRisk[0].riskScore, 25);
  assert.equal(alreadyReleased.indicators.releaseDatePressure, 0);
});

test('scores unresolved upstream dependencies, not downstream or resolved links', () => {
  const result = summarizeReleaseRisk([
    {
      key: 'PROJ-1',
      fields: {
        summary: 'Ship the feature',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'Medium' },
        assignee: { accountId: 'owner' },
        updated: '2026-11-14T10:00:00.000Z',
        issuelinks: [
          {
            type: { inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: {
              key: 'PROJ-2',
              fields: {
                summary: 'Internal API prerequisite',
                status: { name: 'To Do', statusCategory: { key: 'new' } },
              },
            },
          },
          {
            type: { inward: 'is depended on by', outward: 'depends on' },
            outwardIssue: {
              key: 'CORE-3',
              fields: {
                summary: 'Shared service dependency',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              },
            },
          },
          {
            type: { inward: 'is blocked by', outward: 'blocks' },
            outwardIssue: {
              key: 'PROJ-4',
              fields: {
                summary: 'Downstream task',
                status: { name: 'To Do', statusCategory: { key: 'new' } },
              },
            },
          },
          {
            type: { inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: {
              key: 'CORE-5',
              fields: {
                summary: 'Resolved prerequisite',
                status: { name: 'Done', statusCategory: { key: 'done' } },
              },
            },
          },
          {
            type: { inward: 'relates to', outward: 'relates to' },
            inwardIssue: {
              key: 'CORE-6',
              fields: {
                summary: 'Related issue',
                status: { name: 'To Do', statusCategory: { key: 'new' } },
              },
            },
          },
        ],
      },
    },
    {
      key: 'PROJ-2',
      fields: {
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        priority: { name: 'Medium' },
        assignee: { accountId: 'owner' },
        updated: '2026-11-14T10:00:00.000Z',
      },
    },
  ], { now: NOW });

  assert.deepEqual(result.indicators, {
    blocked: 0,
    highPriority: 0,
    overdue: 0,
    unassigned: 0,
    stale: 0,
    dependencyBlocked: 1,
    dependencyOutsideAnalyzedSet: 1,
    releaseDatePressure: 0,
  });
  assert.equal(result.highestRisk[0].key, 'PROJ-1');
  assert.equal(result.highestRisk[0].riskScore, 25);
  assert.equal(result.highestRisk[0].riskLevel, 'elevated');
  assert.deepEqual(result.highestRisk[0].blockingIssues, [
    {
      key: 'PROJ-2',
      summary: 'Internal API prerequisite',
      status: 'To Do',
      inAnalyzedSet: true,
    },
    {
      key: 'CORE-3',
      summary: 'Shared service dependency',
      status: 'In Progress',
      inAnalyzedSet: false,
    },
  ]);
});
