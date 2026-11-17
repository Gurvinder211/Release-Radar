import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnresolvedReleaseJql, selectProjectVersion } from '../src/releaseTarget.js';

test('selects the exact target version and builds a version-scoped unresolved query', () => {
  const version = selectProjectVersion([
    { id: '10001', name: 'Previous release' },
    { id: '10002', name: 'Winter 2027' },
  ], 'Winter 2027');

  assert.equal(version.id, '10002');
  assert.equal(
    buildUnresolvedReleaseJql('DESIGN', version.id),
    'project = "DESIGN" AND fixVersion = 10002 AND resolution IS EMPTY ORDER BY priority DESC, updated ASC',
  );
});

test('rejects unknown, ambiguous, and malformed project versions', () => {
  assert.throws(
    () => selectProjectVersion([{ id: '10001', name: 'Other' }], 'Winter 2027'),
    /No Jira version exactly matches/,
  );
  assert.throws(
    () => selectProjectVersion([
      { id: '10001', name: 'Winter 2027' },
      { id: '10002', name: 'Winter 2027' },
    ], 'Winter 2027'),
    /More than one Jira version/,
  );
  assert.throws(
    () => selectProjectVersion([{ id: '10001 OR project is not EMPTY', name: 'Winter 2027' }], 'Winter 2027'),
    /valid ID/,
  );
  assert.throws(
    () => buildUnresolvedReleaseJql('DESIGN', '10002 OR project is not EMPTY'),
    /valid Jira version ID/,
  );
});
