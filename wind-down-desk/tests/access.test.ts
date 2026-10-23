import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessLine, parseAccess, parseAccessCommand } from '../src/logic/access.ts';

test('accessibility settings: read safely, anything broken means the defaults', () => {
  assert.deepEqual(parseAccess('{"gazeSelect":true,"contrast":1,"largeText":true}'), { gazeSelect: true, contrast: false, largeText: true });
  assert.deepEqual(parseAccess('{'), { gazeSelect: false, contrast: false, largeText: false });
  assert.deepEqual(parseAccess(null), { gazeSelect: false, contrast: false, largeText: false });
});

test('spoken settings, on and off; a worry never toggles a setting', () => {
  assert.deepEqual(parseAccessCommand('look to select'), { gazeSelect: true });
  assert.deepEqual(parseAccessCommand('hands again'), { gazeSelect: false });
  assert.deepEqual(parseAccessCommand('high contrast'), { contrast: true });
  assert.deepEqual(parseAccessCommand('contrast off'), { contrast: false });
  assert.deepEqual(parseAccessCommand('bigger text'), { largeText: true });
  assert.deepEqual(parseAccessCommand('i cant read that'), { largeText: true });
  assert.equal(parseAccessCommand('i need bigger text on the slides for monday'), null);
  assert.equal(accessLine({ gazeSelect: true }), 'Look at something for a moment to choose it.');
});
