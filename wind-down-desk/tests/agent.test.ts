import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmAgent, type ChatProvider } from '../src/shared/agent/llm-agent.ts';
import { extractJson, parseDrafts, parsePlan } from '../src/shared/agent/parse.ts';
import { extractDrafts, planFor, SimulatedAgent, titleFor } from '../src/shared/agent/simulated.ts';
import { LIMITS } from '../src/shared/agent/types.ts';

const DUMP =
  "Okay. I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year. " +
  "The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. " +
  'Oh, and my passport expires in March.';

test('simulated agent splits a real brain dump into short stones', () => {
  const drafts = extractDrafts(DUMP);
  const titles = drafts.map((d) => d.title);
  assert.equal(drafts.length, 5, titles.join(' | '));
  for (const d of drafts) {
    assert.ok(d.title.length <= LIMITS.titleChars, d.title);
    assert.ok(/^[A-Z]/u.test(d.title), d.title);
  }
  assert.match(titles[0], /landlord/iu);
  const bySuggestion = Object.fromEntries(drafts.map((d) => [d.title, d.suggestion]));
  assert.equal(bySuggestion[titles[0]], 'tomorrow');
  assert.equal(drafts.find((d) => /comment/iu.test(d.title))?.suggestion, 'let-go');
  assert.equal(drafts.find((d) => /passport/iu.test(d.title))?.suggestion, 'later');
});

test('filler is ignored and duplicates of the desk are skipped', () => {
  assert.equal(extractDrafts("um. that's it.").length, 0);
  const again = extractDrafts('I need to book the dentist', ['Book the dentist']);
  assert.equal(again.length, 0);
  assert.equal(titleFor('so um I need to call my mum'), 'Call my mum');
});

test('simulated plan: urgent first, at most 3 tiny steps, lighter on request', () => {
  const plan = planFor({
    tomorrow: [{ title: 'Renew passport' }, { title: 'Reply to the landlord' }, { title: 'Book the dentist' }, { title: 'Slides for Monday' }],
    later: [],
    letGoCount: 1,
  });
  assert.equal(plan.steps.length, 3);
  assert.match(plan.steps[0].title, /landlord|Monday/u);
  assert.ok(plan.steps.every((s) => /^\d{2}:\d{2}$/u.test(s.when) && s.step.length <= LIMITS.stepChars));
  assert.ok(plan.steps[0].when < plan.steps[1].when);
  assert.match(plan.note, /other 1/u);
  const lighter = planFor({ tomorrow: [{ title: 'a b' }, { title: 'c d' }, { title: 'e f' }], later: [], letGoCount: 0, lighter: true });
  assert.equal(lighter.steps.length, 2);
  assert.equal(planFor({ tomorrow: [], later: [], letGoCount: 0 }).steps.length, 0);
});

test('LLM JSON is found inside fences and prose, then validated and clamped', () => {
  assert.deepEqual(extractJson('Sure! ```json\n{"a":[1,{"b":"}"}]}\n``` hope it helps'), { a: [1, { b: '}' }] });
  assert.equal(extractJson('no json here'), null);
  const drafts = parseDrafts(
    'Here: {"tokens":[{"title":"reply to the landlord about the broken heating please","suggestion":"Let Go"},' +
      '{"title":"Dentist","suggestion":"today"},{"title":"","suggestion":"later"},{"title":"Dentist!","suggestion":"later"},{"nope":1}]}',
  );
  assert.ok(drafts != null);
  assert.equal(drafts.length, 2);
  assert.ok(drafts[0].title.length <= LIMITS.titleChars);
  assert.equal(drafts[0].suggestion, 'let-go');
  assert.equal(drafts[1].suggestion, 'tomorrow');
  assert.equal(parseDrafts('{"tokens": "nope"}'), null);
  const plan = parsePlan('{"steps":[{"title":"Landlord","step":"Draft 3 lines","when":"9:05","minutes":"500"},{"title":"x"}],"note":"Rest."}');
  assert.deepEqual(plan, { steps: [{ title: 'Landlord', step: 'Draft 3 lines', when: '09:05', minutes: 90 }], note: 'Rest.' });
  assert.equal(parsePlan('{"steps":[]}'), null);
});

test('LLM agent degrades to the on-device agent on errors and junk', async () => {
  const failing: ChatProvider = { name: 'fake', complete: async () => { throw new Error('timeout'); } };
  const junk: ChatProvider = { name: 'junk', complete: async () => 'I cannot help with that.' };
  const good: ChatProvider = {
    name: 'good',
    complete: async (messages) =>
      messages[0].content.includes('worry stones')
        ? '{"tokens":[{"title":"Call mum","detail":"call my mum","suggestion":"tomorrow","why":"Easy win"}]}'
        : '{"steps":[{"title":"Call mum","step":"Call at lunch","when":"12:30","minutes":10}],"note":"Gently."}',
  };
  const a = new LlmAgent(failing);
  assert.equal((await a.extract(DUMP)).length, 5);
  assert.equal(a.stats.fallbacks, 1);
  const b = new LlmAgent(junk);
  assert.ok((await b.plan({ tomorrow: [{ title: 'Reply to landlord' }], later: [], letGoCount: 0 })).steps.length === 1);
  assert.equal(b.stats.fallbacks, 1);
  const c = new LlmAgent(good);
  assert.deepEqual((await c.extract('I should call my mum')).map((d) => d.title), ['Call mum']);
  assert.equal((await c.plan({ tomorrow: [{ title: 'Call mum' }], later: [], letGoCount: 0 })).note, 'Gently.');
  assert.equal(c.stats.fallbacks, 0);
  assert.equal(new SimulatedAgent().name.includes('simulated'), true);
});

test('v7: spelled-out negations still give a clean stone title (typed in the play-test console)', () => {
  assert.equal(titleFor('I still have not replied to the landlord about the heating.'), 'Reply to the landlord');
  assert.equal(extractDrafts("I didn't call my mum back.")[0]?.title, 'Call my mum back');
  assert.equal(extractDrafts('That is it.').length, 0);
});

test('v8: a pronoun alone never becomes a stone ("I keep replaying that.")', async () => {
  const { extractDrafts } = await import('../src/shared/agent/simulated.ts');
  const titles = extractDrafts("The slides for Monday aren't done. I keep replaying that.", ['Reply to the landlord']).map((d) => d.title);
  assert.deepEqual(titles, ['Slides for Monday']);
});
