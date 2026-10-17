const assert = require('node:assert/strict');
const { createPlan, nextWorkCue } = require('../timer-core');
const plan = createPlan({ warmup: 10, work: 20, rest: 5, roundRest: 10, rounds: 2, exercises: ['A', 'B'] });
assert.equal(nextWorkCue(plan, 0, 8001), null);
assert.deepEqual(nextWorkCue(plan, 0, 8000), { index: 1, title: 'A' });
assert.equal(nextWorkCue(plan, 0, 7900, 1), null);
// A five-second pause means the cue belongs three seconds before work ends.
assert.equal(nextWorkCue(plan, 1, 3001), null);
assert.deepEqual(nextWorkCue(plan, 1, 3000), { index: 3, title: 'B' });
assert.equal(nextWorkCue(plan, 2, 5000, 3), null);
assert.deepEqual(nextWorkCue(plan, 4, 8000), { index: 5, title: 'A' });
assert.equal(nextWorkCue(plan, plan.length - 1, 8000), null);
const noRest = createPlan({ warmup: 0, work: 20, rest: 0, roundRest: 0, rounds: 1, exercises: ['A', 'B'] });
assert.deepEqual(nextWorkCue(noRest, 0, 8000), { index: 1, title: 'B' });
assert.equal(nextWorkCue(noRest, 0, 0), null);
console.log('PASS: Eight-second cue, short/no pauses, rounds, no duplicate, workout end');

// A preannounced exercise keeps its start beep and screen-reader update,
// but does not repeat the spoken name. Unannounced starts still speak.
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const advanceSource = source.slice(source.indexOf('  function advance(timeNow)'), source.indexOf('  function tick()'));
for (const announcedWork of [1, -1]) {
  const spoken = [];
  const sounds = [];
  const context = {
    plan: [{ kind: 'rest', seconds: 10 }, { kind: 'work', title: 'Kniebeugen', seconds: 40 }],
    state: { status: 'running', index: 0, remainingMs: 0, deadline: 10000, announcedWork },
    phaseSound: kind => sounds.push(kind),
    say: (message, audible) => spoken.push({ message, audible })
  };
  vm.createContext(context);
  vm.runInContext(advanceSource, context);
  context.advance(10000);
  assert.equal(spoken[0].audible, announcedWork !== 1);
  assert.equal(spoken[0].message, 'Kniebeugen. 40 Sekunden.');
  assert.deepEqual(sounds, ['work']);
}
console.log('PASS: No duplicate speech at preannounced exercise start; beep preserved');
