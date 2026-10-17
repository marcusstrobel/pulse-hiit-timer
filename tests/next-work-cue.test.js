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
