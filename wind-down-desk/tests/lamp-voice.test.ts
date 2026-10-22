import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caption, type RitualState } from '../src/logic/ritual.ts';
import { envelopeAt, lampLines, lineFile, lineKey, type VoiceManifest } from '../src/logic/lamp-lines.ts';
import { parseVoiceToggle } from '../src/logic/voice-intents.ts';

const manifest = (JSON.parse(readFileSync(new URL('../public/voice/lines.json', import.meta.url), 'utf8')) as { lines: VoiceManifest }).lines;

test('every catalogue line has a pre-rendered clip with an envelope', () => {
  for (const line of lampLines()) {
    const clip = manifest[lineKey(line)];
    assert.ok(clip != null, `missing voice for "${line}"`);
    assert.equal(clip.file, lineFile(line));
    assert.ok(clip.seconds > 0.3 && clip.seconds < 8, `${line}: ${clip.seconds}s`);
    assert.ok(clip.envelope.length >= Math.floor(clip.seconds * 30) - 1);
    assert.ok(readFileSync(new URL(`../public/voice/${clip.file}`, import.meta.url)).byteLength > 1000);
  }
});

test('every phase caption is spoken (the voice never drifts from the text)', () => {
  const phases: RitualState['phase'][] = ['arrive', 'dump', 'sort', 'plan', 'night', 'morning'];
  const keys = new Set(lampLines().map(lineKey));
  for (const phase of phases) {
    for (const tokensOnDesk of [0, 3]) {
      for (const listening of [true, false]) {
        for (const micAvailable of [true, false]) {
          for (const unsorted of [1, 3]) {
            const text = caption({ phase, tokensOnDesk } as RitualState, { listening, micAvailable, unsorted });
            assert.ok(keys.has(lineKey(text)), `caption not voiced: "${text}"`);
          }
        }
      }
    }
  }
});

test('keys ignore punctuation and case; envelope is read between samples', () => {
  assert.equal(lineKey('Tomorrow. 2 left.'), lineKey('tomorrow 2 left'));
  assert.equal(lineKey("Say \"that's it\" now…"), 'say thats it now');
  const clip = { file: 'x.mp3', seconds: 1, envelope: [0, 1, 0.5] };
  assert.equal(envelopeAt(clip, -0.1), 0);
  assert.ok(Math.abs(envelopeAt(clip, 0.5 / 30) - 0.5) < 1e-9);
  assert.equal(envelopeAt(clip, 2), 0);
});

test('voice on / off by voice, whole sentence only', () => {
  assert.equal(parseVoiceToggle('voice off'), false);
  assert.equal(parseVoiceToggle('be quiet'), false);
  assert.equal(parseVoiceToggle('talk to me'), true);
  assert.equal(parseVoiceToggle('voice on'), true);
  assert.equal(parseVoiceToggle('i lost my voice at the meeting'), null);
  assert.equal(parseVoiceToggle('my boss told me to be quiet'), null);
  // One switch for all sound (owner, 18 Oct): "sound off/on", "mute the sound", "unmute".
  assert.equal(parseVoiceToggle('sound off'), false);
  assert.equal(parseVoiceToggle('mute the sound'), false);
  assert.equal(parseVoiceToggle('sound on'), true);
  assert.equal(parseVoiceToggle('unmute'), true);
  assert.equal(parseVoiceToggle('the sound of the rain keeps me awake'), null);
});
