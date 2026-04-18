import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCsvRows } from '../backend/dist/backend/src/sources/http.js';
import { getAnalysisDate } from '../backend/dist/backend/src/utils/date.js';

test('getAnalysisDate ignores blank strings and falls back to today', () => {
  const result = getAnalysisDate('');

  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('parseCsvRows handles quoted commas and escaped quotes', () => {
  const rows = parseCsvRows(
    '"player_id","player_name","note"\n"123","Doe, John","He said ""hello"""',
  );

  assert.deepEqual(rows, [
    ['player_id', 'player_name', 'note'],
    ['123', 'Doe, John', 'He said "hello"'],
  ]);
});
