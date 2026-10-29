import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMix, DEFAULT_MIX, MIX_LINES, parseMix, parseMixCommand } from '../src/logic/mix.ts';
import { parseVoiceToggle } from '../src/logic/voice-intents.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';

test('the voice is softer than the ambience by default; saved values are read safely', () => {
  assert.ok(DEFAULT_MIX.voice < 0.9 && DEFAULT_MIX.voice >= 0.6, 'softer than the 0.9 of before, still clear');
  assert.equal(DEFAULT_MIX.sound, 1);
  assert.deepEqual(parseMix(null), DEFAULT_MIX);
  assert.deepEqual(parseMix('not json'), DEFAULT_MIX);
  assert.deepEqual(parseMix('{"voice":0.4}'), { voice: 0.4, sound: 1 });
  assert.deepEqual(parseMix('{"voice":7,"sound":-2}'), { voice: 1, sound: 0 }, 'clamped');
  assert.deepEqual(applyMix(DEFAULT_MIX, { sound: 0.55 }), { voice: DEFAULT_MIX.voice, sound: 0.55 });
});

test('voice commands for each channel, whole sentences only; "sound off" stays the one mute', () => {
  assert.deepEqual(parseMixCommand('voice softer'), { type: 'step', channel: 'voice', delta: -0.2 });
  assert.deepEqual(parseMixCommand('Softer voice please'), { type: 'step', channel: 'voice', delta: -0.2 });
  assert.deepEqual(parseMixCommand('speak more softly'), { type: 'step', channel: 'voice', delta: -0.2 });
  assert.deepEqual(parseMixCommand('the music a bit louder'), { type: 'step', channel: 'sound', delta: 0.2 });
  assert.deepEqual(parseMixCommand('ambience quieter'), { type: 'step', channel: 'sound', delta: -0.2 });
  assert.deepEqual(parseMixCommand('volume'), { type: 'open' });
  assert.equal(parseMixCommand('my voice was softer today'), null);
  assert.equal(parseMixCommand('sound off'), null, 'the mute is not a mix step');
  assert.equal(parseVoiceToggle('sound off'), false);
  assert.equal(parseVoiceToggle('voice softer'), null, 'and a mix step is not a mute');
});

test('the mix lines are voiced', () => {
  const keys = new Set(lampLines().map(lineKey));
  for (const line of Object.values(MIX_LINES)) assert.ok(keys.has(lineKey(line)), line);
});
