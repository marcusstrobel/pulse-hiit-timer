/* Pure workout planning logic. Intentionally dependency-free and testable in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HIITCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULTS = Object.freeze({
    work: 40, rest: 20, roundRest: 60, warmup: 60, rounds: 3,
    exercises: ['Liegestütze', 'Stehende Kurzhantel-Bizepscurls', 'Kniebeugen mit Hanteln', 'Schulterdrücken mit Kurzhanteln', 'Sit-Ups'],
    sound: true
  });
  function intInRange(value, fallback, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  }
  function normalize(raw = {}) {
    const exercises = Array.isArray(raw.exercises)
      ? raw.exercises.map(x => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 15)
      : [...DEFAULTS.exercises];
    return {
      work: intInRange(raw.work, DEFAULTS.work, 5, 600),
      rest: intInRange(raw.rest, DEFAULTS.rest, 0, 600),
      roundRest: intInRange(raw.roundRest, DEFAULTS.roundRest, 0, 600),
      warmup: intInRange(raw.warmup, DEFAULTS.warmup, 0, 600),
      rounds: intInRange(raw.rounds, DEFAULTS.rounds, 1, 20),
      exercises: exercises.length ? exercises : [...DEFAULTS.exercises],
      sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound
    };
  }
  function createPlan(raw) {
    const s = normalize(raw);
    const plan = [];
    if (s.warmup) plan.push({ kind: 'warmup', title: 'Warm-up', seconds: s.warmup, round: 0, exerciseIndex: -1 });
    for (let r = 1; r <= s.rounds; r++) {
      s.exercises.forEach((title, idx) => {
        plan.push({ kind: 'work', title, seconds: s.work, round: r, exerciseIndex: idx });
        if (idx < s.exercises.length - 1 && s.rest) {
          plan.push({ kind: 'rest', title: 'Durchatmen', seconds: s.rest, round: r, exerciseIndex: idx });
        }
      });
      if (s.roundRest) {
        plan.push({ kind: 'roundRest', title: 'Rundenpause', seconds: s.roundRest, round: r, exerciseIndex: s.exercises.length - 1 });
      }
    }
    return plan;
  }
  function totalSeconds(plan) { return plan.reduce((sum, phase) => sum + phase.seconds, 0); }
  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function upcomingWork(plan, fromIndex) { return plan.slice(fromIndex + 1).find(x => x.kind === 'work') || null; }
  return { DEFAULTS, normalize, createPlan, totalSeconds, formatTime, upcomingWork };
});
