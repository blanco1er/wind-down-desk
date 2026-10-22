import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mixLight, nextPlace, parsePlaceCommand, PLACE_IDS, PLACES, ROOM_LIGHT } from '../src/logic/places.ts';
import { normalize } from '../src/logic/text.ts';

const cmd = (s: string) => parsePlaceCommand(normalize(s));

test('every place can be reached by voice, and your room is always one sentence away', () => {
  // Night places (19 Oct 2026): the coordinator's mapping.
  assert.deepEqual(cmd('Take me to the lake'), { type: 'place', place: 'moon-lake' });
  assert.deepEqual(cmd('take me to the beach'), { type: 'place', place: 'moon-beach' });
  assert.deepEqual(cmd('take me to the snow'), { type: 'place', place: 'northern-lights' });
  assert.deepEqual(cmd('take me to the cabin'), { type: 'place', place: 'northern-lights' });
  assert.deepEqual(cmd('show me the northern lights'), { type: 'place', place: 'northern-lights' });
  assert.deepEqual(cmd('go to the garden'), { type: 'place', place: 'rain-veranda' });
  assert.deepEqual(cmd('take me to the rain'), { type: 'place', place: 'rain-veranda' });
  assert.deepEqual(cmd('show me the stars'), { type: 'place', place: 'desert-stars' });
  assert.deepEqual(cmd('show me the desert'), { type: 'place', place: 'desert-stars' });
  assert.deepEqual(cmd('Take me to the fire.'), { type: 'place', place: 'ember-fire' });
  assert.deepEqual(cmd('By the fire.'), { type: 'place', place: 'ember-fire' });
  assert.deepEqual(cmd('take me to the campfire'), { type: 'place', place: 'ember-fire' });
  assert.deepEqual(cmd('take me to the fireplace'), { type: 'place', place: 'fireside-cabin' });
  assert.deepEqual(cmd('take me to the fireflies'), { type: 'place', place: 'firefly-meadow' });
  assert.deepEqual(cmd('go to the meadow'), { type: 'place', place: 'firefly-meadow' });
  assert.deepEqual(cmd('take me to the city'), { type: 'place', place: 'rooftop-city' });
  assert.deepEqual(cmd('go to the rooftop'), { type: 'place', place: 'rooftop-city' });
  assert.equal(cmd('go to the forest'), null);
  assert.deepEqual(cmd('Back to my room'), { type: 'place', place: 'room' });
  assert.deepEqual(cmd('take me home'), { type: 'place', place: 'room' });
  assert.deepEqual(cmd('Places'), { type: 'places' });
  assert.deepEqual(cmd('full immersion'), { type: 'immersion', level: 'full' });
  assert.deepEqual(cmd('keep my table'), { type: 'immersion', level: 'table' });
});

test('a brain dump that mentions a place never moves you', () => {
  assert.equal(cmd('I need to call about the lake house booking'), null);
  assert.equal(cmd('the garden fence is broken and the rain got in'), null);
  assert.equal(cmd('my room is a mess'), null);
});

test('places are complete, credited, and the light crossfades smoothly', () => {
  for (const id of PLACE_IDS) {
    const p = PLACES[id];
    assert.equal(p.id, id);
    if (id !== 'room') {
      assert.ok(p.photo?.startsWith('./environments/') && p.photo.endsWith('.ktx2') && p.thumb != null, `${id} photo`);
      assert.ok(p.fallback?.endsWith('.jpg'), `${id} JPG fallback`);
      // Honest provenance: AI-generated panoramas say so.
      assert.match(p.credit, /AI-generated/u);
      for (const file of [p.photo, p.fallback, p.thumb]) {
        assert.ok(existsSync(new URL(`../public/${file!.slice(2)}`, import.meta.url)), `${file} shipped`);
      }
    }
  }
  assert.equal(nextPlace('room'), 'ember-fire');
  assert.equal(nextPlace('rooftop-city'), 'room');
  const lake = PLACES['moon-lake'].light;
  const mid = mixLight(ROOM_LIGHT, lake, 0.5);
  assert.ok(Math.abs(mid.key[0] - (ROOM_LIGHT.key[0] + lake.key[0]) / 2) < 1e-9);
  assert.deepEqual(mixLight(ROOM_LIGHT, lake, 2).key, lake.key);
});

test('the menu: your room then the nine night places (5 × 2 grid), no duplicates', async () => {
  const { MENU_PLACES } = await import('../src/logic/places.ts');
  assert.deepEqual(MENU_PLACES, ['room', 'ember-fire', 'moon-lake', 'moon-beach', 'northern-lights', 'rain-veranda', 'firefly-meadow', 'desert-stars', 'fireside-cabin', 'rooftop-city']);
  assert.equal(new Set(MENU_PLACES.map((id) => PLACES[id].name)).size, MENU_PLACES.length);
  // Night panoramas only deepen gently with the evening (environment.ts reads grade.evening).
  for (const id of MENU_PLACES.slice(1)) assert.ok(((PLACES[id].grade as { evening?: number }).evening ?? 1) < 0.6, id);
});

test('quiet evening: touch words for Unload, tonight\'s stones for Release, a remembered choice', async () => {
  const { unloadChoices, releaseChoices, readStyle, writeStyle, QUIET_TOPICS, WRITE_LABEL, DONE_LABEL } = await import('../src/logic/style.ts');
  const empty = unloadChoices(new Set(), 0);
  assert.equal(empty.length, QUIET_TOPICS.length + 1);
  assert.equal(empty.at(-1)?.label, WRITE_LABEL);
  const some = unloadChoices(new Set(['Work']), 2);
  assert.equal(some.find((w) => w.label === 'Work')?.dim, true);
  assert.equal(some.at(-1)?.label, DONE_LABEL);
  assert.ok(some.length <= 12, 'fits the 4 × 3 grid');
  const r = releaseChoices(['Family', 'Money'], ['money', 'Work']);
  assert.deepEqual(r.map((w) => w.label), ['Money', 'Family', 'Work', WRITE_LABEL]);
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(readStyle(store), null);
  writeStyle(store, 'quiet');
  assert.equal(readStyle(store), 'quiet');
});
