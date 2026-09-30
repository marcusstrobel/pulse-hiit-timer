'use strict';
(() => {
  const { DEFAULTS, normalize, createPlan, totalSeconds, formatTime, upcomingWork } = window.HIITCore;
  const $ = id => document.getElementById(id);
  const storageKey = 'pulse-hiit-settings-v1';
  const circumference = 2 * Math.PI * 139;
  const phases = { warmup: 'BEREIT MACHEN', work: 'VOLLGAS GEBEN', rest: 'KURZ DURCHATMEN', roundRest: 'RUNDENPAUSE', complete: 'GESCHAFFT!' };
  const numberFields = { workInput: 'work', restInput: 'rest', roundRestInput: 'roundRest', warmupInput: 'warmup' };
  let settings = loadSettings();
  let plan = createPlan(settings);
  let state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1 };
  let intervalId = null;
  let audioCtx = null;
  let wakeLock = null;
  let lastRenderedSecond = -1;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? normalize(JSON.parse(raw)) : normalize(DEFAULTS);
    } catch (_) { return normalize(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (_) {} }
  function say(message) { $('screenreaderUpdates').textContent = message; }
  function prepareAudio() {
    if (!settings.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audioCtx = audioCtx || new Audio();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (_) {}
  }
  function tone(freq = 700, duration = .12, when = 0) {
    if (!settings.sound || !audioCtx || audioCtx.state !== 'running') return;
    try {
      const start = audioCtx.currentTime + when;
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.16, start + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain); gain.connect(audioCtx.destination);
      oscillator.start(start); oscillator.stop(start + duration + .02);
    } catch (_) {}
  }
  function phaseSound(kind) {
    if (kind === 'work') { tone(860, .12); tone(1050, .19, .16); }
    else if (kind === 'complete') { tone(660, .13); tone(880, .14, .18); tone(1100, .30, .38); }
    else tone(570, .17);
    if (navigator.vibrate) navigator.vibrate(kind === 'work' ? [90, 70, 90] : 85);
  }
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || state.status !== 'running' || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (_) {}
  }
  function releaseWakeLock() { if (wakeLock) { const lock = wakeLock; wakeLock = null; lock.release().catch(() => {}); } }
  function setInputValues() {
    for (const [id, key] of Object.entries(numberFields)) $(id).value = settings[key];
    $('roundCount').textContent = settings.rounds;
    $('statWork').textContent = settings.work;
    $('statRest').textContent = settings.rest;
    $('statRounds').textContent = String(settings.rounds).padStart(2, '0');
    $('totalTime').innerHTML = `${formatTime(totalSeconds(plan))} <small>MIN</small>`;
    $('exerciseCount').textContent = `${settings.exercises.length} ${settings.exercises.length === 1 ? 'ÜBUNG' : 'ÜBUNGEN'}`;
    $('soundBtn').classList.toggle('is-muted', !settings.sound);
    $('soundBtn').setAttribute('aria-pressed', String(settings.sound));
    $('soundBtn').setAttribute('aria-label', settings.sound ? 'Ton ausschalten' : 'Ton einschalten');
  }
  function renderExercises() {
    const list = $('exerciseList');
    list.replaceChildren();
    settings.exercises.forEach((name, i) => {
      const row = document.createElement('div'); row.className = 'exercise-row';
      const number = document.createElement('span'); number.className = 'exercise-index'; number.textContent = String(i + 1).padStart(2, '0');
      const input = document.createElement('input'); input.className = 'exercise-input'; input.type = 'text'; input.maxLength = 60;
      input.value = name; input.setAttribute('aria-label', `Name der Übung ${i + 1}`);
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (!value) { input.value = settings.exercises[i]; return; }
        settings.exercises[i] = value; syncPlan();
      });
      const actions = document.createElement('div'); actions.className = 'exercise-actions';
      const mk = (label, symbol, handler, additionalClass = '') => {
        const button = document.createElement('button'); button.type = 'button'; button.className = `row-button ${additionalClass}`;
        button.setAttribute('aria-label', label); button.title = label; button.textContent = symbol;
        button.disabled = state.status === 'running' || state.status === 'paused'; button.addEventListener('click', handler); return button;
      };
      actions.append(
        mk('Übung nach oben', '↑', () => reorder(i, -1)),
        mk('Übung nach unten', '↓', () => reorder(i, 1)),
        mk('Übung entfernen', '×', () => { if (settings.exercises.length < 2) return; settings.exercises.splice(i, 1); syncPlan(); renderExercises(); }, 'delete')
      );
      actions.firstElementChild.dataset.boundaryDisabled = String(i === 0);
      actions.children[1].dataset.boundaryDisabled = String(i === settings.exercises.length - 1);
      actions.children[2].dataset.boundaryDisabled = String(settings.exercises.length < 2);
      row.append(number, input, actions); list.append(row);
    });
    setControlsDisabled();
  }
  function reorder(i, delta) {
    const j = i + delta; if (j < 0 || j >= settings.exercises.length) return;
    [settings.exercises[i], settings.exercises[j]] = [settings.exercises[j], settings.exercises[i]];
    syncPlan(); renderExercises();
  }
  function syncPlan() {
    plan = createPlan(settings);
    state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1 };
    lastRenderedSecond = -1; saveSettings(); setInputValues(); renderTimer();
  }
  function setControlsDisabled() {
    const locked = state.status === 'running' || state.status === 'paused';
    Object.keys(numberFields).forEach(id => $(id).disabled = locked);
    ['minusRound', 'plusRound', 'addExerciseBtn', 'restoreBtn'].forEach(id => $(id).disabled = locked);
    document.querySelectorAll('.exercise-input,.row-button').forEach(el => { el.disabled = locked || el.dataset.boundaryDisabled === 'true'; });
  }
  function markPhase(phase) {
    document.querySelector('.timer-panel').dataset.phase = phase;
    $('phaseText').textContent = phases[phase] || 'PAUSIERT';
  }
  function renderTimer() {
    const complete = state.status === 'complete';
    const segment = complete ? null : plan[state.index];
    const kind = complete ? 'complete' : segment.kind;
    markPhase(kind);
    $('phaseText').textContent = state.status === 'paused' ? 'PAUSIERT' : phases[kind];
    $('timer-heading').textContent = complete ? 'Stark gemacht!' : segment.title;
    const next = complete ? null : upcomingWork(plan, state.index);
    $('nextText').textContent = complete ? 'Dein Workout ist abgeschlossen.' : next ? `Danach: ${next.title}` : 'Letztes Intervall – zieh durch!';
    $('roundBadge').textContent = complete ? 'ALLE RUNDEN GESCHAFFT' : `RUNDE ${Math.max(1, segment.round)} VON ${settings.rounds}`;
    $('sessionNumber').textContent = `${String(complete ? settings.rounds : Math.max(1,segment.round)).padStart(2,'0')} / ${String(settings.rounds).padStart(2,'0')}`;
    const seconds = complete ? 0 : state.remainingMs / 1000;
    const displayed = formatTime(seconds);
    $('timeDisplay').textContent = displayed;
    const integerSeconds = Math.ceil(seconds);
    if (lastRenderedSecond !== integerSeconds || complete) {
      $('timeDisplay').setAttribute('aria-label', complete ? 'Workout abgeschlossen' : `Noch ${integerSeconds} Sekunden`);
      lastRenderedSecond = integerSeconds;
    }
    $('timeLabel').textContent = complete ? 'DU HAST ES' : state.status === 'paused' ? 'ANGEHALTEN' : state.status === 'ready' ? 'START IN' : 'NOCH';
    $('dialDetail').textContent = complete ? 'GESCHAFFT!' : `${segment.seconds} SEKUNDEN`;
    const phaseProgress = complete ? 0 : Math.max(0, Math.min(1, 1 - state.remainingMs / (segment.seconds * 1000)));
    $('dialProgress').style.strokeDasharray = String(circumference);
    // Circular ring empties as the interval counts down.
    $('dialProgress').style.strokeDashoffset = String(circumference * phaseProgress);
    const elapsedBefore = plan.slice(0, state.index).reduce((sum, x) => sum + x.seconds, 0);
    const elapsed = complete ? totalSeconds(plan) : elapsedBefore + segment.seconds - state.remainingMs / 1000;
    const percent = Math.max(0, Math.min(100, 100 * elapsed / totalSeconds(plan)));
    $('overallProgress').style.width = percent.toFixed(2) + '%';
    $('progressPercent').textContent = Math.round(percent) + ' %';
    $('previousBtn').disabled = complete || state.index === 0;
    $('nextBtn').disabled = complete;
    $('playLabel').textContent = complete ? 'NOCHMAL STARTEN' : state.status === 'running' ? 'PAUSIEREN' : state.status === 'paused' ? 'FORTSETZEN' : 'WORKOUT STARTEN';
    $('playIcon').innerHTML = state.status === 'running' ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z"/>' : '<path d="m8 5 12 7-12 7V5Z"/>';
  }
  function advance(timeNow) {
    // Use wall-clock deadlines: throttled background timers do not make the workout drift.
    let changed = false;
    while (state.status === 'running' && state.remainingMs <= 0) {
      if (state.index >= plan.length - 1) {
        state.status = 'complete'; state.remainingMs = 0; state.deadline = 0;
        stopTick(); releaseWakeLock(); phaseSound('complete'); say('Workout abgeschlossen. Stark gemacht!'); setControlsDisabled(); renderTimer(); return;
      }
      state.index += 1; changed = true;
      state.deadline += plan[state.index].seconds * 1000;
      state.remainingMs = Math.max(0, state.deadline - timeNow);
      state.lastCue = -1;
    }
    if (changed) {
      const phase = plan[state.index];
      phaseSound(phase.kind);
      say(`${phases[phase.kind]}. ${phase.title}. ${phase.seconds} Sekunden.`);
    }
  }
  function tick() {
    if (state.status !== 'running') return;
    const now = Date.now();
    state.remainingMs = Math.max(0, state.deadline - now);
    if (state.remainingMs <= 0) advance(now);
    if (state.status !== 'running') return;
    const second = Math.ceil(state.remainingMs / 1000);
    if (second <= 3 && second >= 1 && state.lastCue !== second) {
      state.lastCue = second; tone(700 + (3 - second) * 60, .09);
    }
    renderTimer();
  }
  function stopTick() { if (intervalId !== null) { clearInterval(intervalId); intervalId = null; } }
  function startTick() { stopTick(); intervalId = setInterval(tick, 80); }
  function play() {
    if (state.status === 'complete') { reset(false); }
    if (state.status === 'running') {
      tick(); if (state.status !== 'running') return;
      state.status = 'paused'; stopTick(); releaseWakeLock(); say('Pausiert.'); setControlsDisabled(); renderTimer(); return;
    }
    prepareAudio(); state.status = 'running'; state.deadline = Date.now() + state.remainingMs;
    state.lastCue = -1; acquireWakeLock(); startTick();
    say(`${plan[state.index].title} gestartet.`); setControlsDisabled(); renderTimer();
  }
  function skip(delta) {
    if (state.status === 'complete') return;
    const target = state.index + delta;
    if (target < 0) return;
    if (target >= plan.length) { finish(); return; }
    state.index = target;
    state.remainingMs = plan[target].seconds * 1000;
    state.deadline = Date.now() + state.remainingMs;
    state.lastCue = -1;
    if (state.status === 'running') phaseSound(plan[target].kind);
    say(`${plan[target].title}.`);
    renderTimer();
  }
  function finish() {
    stopTick(); releaseWakeLock(); state.status = 'complete'; state.remainingMs = 0;
    phaseSound('complete'); say('Workout abgeschlossen. Stark gemacht!'); setControlsDisabled(); renderTimer();
  }
  function reset(announce = true) {
    stopTick(); releaseWakeLock();
    state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1 };
    lastRenderedSecond = -1; setControlsDisabled(); renderTimer();
    if (announce) say('Workout zurückgesetzt.');
  }
  for (const [id, key] of Object.entries(numberFields)) {
    $(id).addEventListener('change', event => {
      if (state.status === 'running' || state.status === 'paused') return;
      settings[key] = normalize({ ...settings, [key]: event.target.value })[key]; syncPlan();
    });
  }
  $('minusRound').addEventListener('click', () => { if (settings.rounds > 1) { settings.rounds--; syncPlan(); } });
  $('plusRound').addEventListener('click', () => { if (settings.rounds < 20) { settings.rounds++; syncPlan(); } });
  $('addExerciseBtn').addEventListener('click', () => {
    if (settings.exercises.length >= 15) return;
    settings.exercises.push(`Neue Übung ${settings.exercises.length + 1}`);
    syncPlan(); renderExercises(); $('exerciseList').lastElementChild.querySelector('input').focus();
  });
  $('restoreBtn').addEventListener('click', () => { settings = normalize(DEFAULTS); syncPlan(); renderExercises(); say('Standard-Workout wiederhergestellt.'); });
  $('soundBtn').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); setInputValues(); if (settings.sound) { prepareAudio(); tone(860, .15); } });
  $('playBtn').addEventListener('click', play);
  $('previousBtn').addEventListener('click', () => skip(-1));
  $('nextBtn').addEventListener('click', () => skip(1));
  $('resetBtn').addEventListener('click', () => reset());
  if (!document.documentElement.requestFullscreen) $('fullscreenBtn').hidden = true;
  $('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.status === 'running') { tick(); acquireWakeLock(); }
  });
  window.addEventListener('pageshow', () => { if (state.status === 'running') tick(); });
  window.addEventListener('beforeunload', releaseWakeLock);
  setInputValues(); renderExercises(); renderTimer();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
