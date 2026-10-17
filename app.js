'use strict';
(() => {
  const { DEFAULTS, normalize, createPlan, totalSeconds, formatTime, upcomingWork } = window.HIITCore;
  const $ = id => document.getElementById(id);
  const storageKey = 'pulse-hiit-settings-v1';
  const circumference = 2 * Math.PI * 139;
  const phases = { warmup: 'BEREIT MACHEN', work: 'VOLLGAS GEBEN', rest: 'KURZ DURCHATMEN', roundRest: 'RUNDENPAUSE', complete: 'GESCHAFFT!' };
  const numberFields = { workInput: 'work', restInput: 'rest', roundRestInput: 'roundRest', warmupInput: 'warmup' };
  const legacyDefaultExercises = ['Jump Squats', 'Plank Walk', 'Jump Lunges', 'Cross Body Mountain Climbers', 'Burpee mit Tuck Jump'];
  let settings = loadSettings();
  let plan = createPlan(settings);
  let state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1, halfCue: false };
  let intervalId = null;
  let audioCtx = null;
  let wakeLock = null;
  let lastRenderedSecond = -1;
  let swRegistration = null;
  let swHadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  let swReloading = false;
  let swReloadPending = false;

  function isLegacyDefaultSettings(value) {
    return value && typeof value === 'object' &&
      Number(value.work) === 40 && Number(value.rest) === 20 && Number(value.roundRest) === 60 &&
      Number(value.warmup) === 60 && Number(value.rounds) === 3 && value.sound !== false &&
      Array.isArray(value.exercises) && value.exercises.length === legacyDefaultExercises.length &&
      value.exercises.every((name, index) => name === legacyDefaultExercises[index]);
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return normalize(DEFAULTS);
      const parsed = JSON.parse(raw);
      if (isLegacyDefaultSettings(parsed)) {
        const migrated = normalize({ ...parsed, exercises: [...DEFAULTS.exercises] });
        localStorage.setItem(storageKey, JSON.stringify(migrated));
        return migrated;
      }
      return normalize(parsed);
    } catch (_) { return normalize(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (_) {} }
  function speak(message) {
    if (!settings.sound || !settings.speech || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(message);
      utterance.lang = 'de-DE';
      utterance.volume = 1;
      utterance.rate = 1;
      const voices = synth.getVoices();
      const voice = voices.find(v => settings.speechVoice && v.voiceURI === settings.speechVoice && /^(?:de|en)(?:[-_]|$)/i.test(v.lang)) || voices.find(v => /^de[-_]/i.test(v.lang) && v.localService) || voices.find(v => /^de[-_]/i.test(v.lang));
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      synth.speak(utterance);
    } catch (_) {}
  }
  function say(message) {
    $('screenreaderUpdates').textContent = message;
    speak(message);
  }
  function renderVoiceOptions() {
    const available = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const voices = available ? window.speechSynthesis.getVoices() : [];
    const select = $('speechVoice');
    select.replaceChildren(new Option('Automatisch (Deutsch)', ''));
    const groups = [['Deutsch', voices.filter(v => /^de(?:[-_]|$)/i.test(v.lang))],
      ['Englisch', voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang))]];
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const voice of items.sort((a, b) => a.name.localeCompare(b.name))) {
        group.append(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
      }
      select.append(group);
    }
    const missing = settings.speechVoice && !voices.some(v => v.voiceURI === settings.speechVoice && /^(?:de|en)(?:[-_]|$)/i.test(v.lang));
    select.value = missing ? '' : settings.speechVoice;
    select.disabled = !available;
    $('voicePreview').disabled = !available || !settings.sound || !settings.speech;
    $('voiceHint').textContent = !available ? 'Keine Stimmwahl in diesem Browser verfügbar.' : missing
      ? 'Die gespeicherte Stimme ist nicht verfügbar oder weder Deutsch noch Englisch. Es wird automatisch eine deutsche Stimme gewählt.'
      : !voices.length ? 'Der Browser hat noch keine Stimmen gemeldet. Die Liste aktualisiert sich automatisch.'
      : 'Deutsche und englische Stimmen auf diesem Gerät. Mit der Hörprobe findest du die passende Stimme.';
  }
  function setTransferStatus(message, isError = false) {
    const status = $('transferStatus');
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }
  function exportedSettings() {
    return {
      schema: 'pulse-hiit-workout',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        work: settings.work,
        rest: settings.rest,
        roundRest: settings.roundRest,
        warmup: settings.warmup,
        rounds: settings.rounds,
        exercises: [...settings.exercises],
        sound: settings.sound,
        speech: settings.speech,
        speechVoice: settings.speechVoice
      }
    };
  }
  async function exportSettings() {
    const data = JSON.stringify(exportedSettings(), null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `pulse-hiit-workout-${date}.json`;
    const file = new File([data], filename, { type: 'application/json' });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'PULSE HIIT Workout', text: 'Meine PULSE HIIT Workout-Konfiguration' });
        setTransferStatus('Workout exportiert.');
        say('Workout-Konfiguration exportiert.');
        return;
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferStatus('Workout-Datei gespeichert.');
      say('Workout-Konfiguration als Datei gespeichert.');
    } catch (error) {
      if (error?.name === 'AbortError') {
        setTransferStatus('Export abgebrochen.');
        return;
      }
      setTransferStatus('Export nicht möglich.', true);
      say('Export der Workout-Konfiguration fehlgeschlagen.');
    }
  }
  function validateImportedSettings(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Ungültige Datei');
    const candidate = payload.schema === 'pulse-hiit-workout'
      ? payload.settings
      : payload.settings && typeof payload.settings === 'object'
        ? payload.settings
        : payload;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Keine Einstellungen gefunden');
    if (!Array.isArray(candidate.exercises) || candidate.exercises.length < 1) throw new Error('Übungsliste fehlt');
    if (candidate.exercises.length > 15) throw new Error('Maximal 15 Übungen erlaubt');
    if (!candidate.exercises.every(name => typeof name === 'string' && name.trim())) throw new Error('Ungültige Übungsliste');
    return normalize(candidate);
  }
  async function importSettingsFile(file) {
    if (!file) return;
    if (state.status === 'running' || state.status === 'paused') {
      setTransferStatus('Import während eines laufenden Workouts nicht möglich.', true);
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      settings = validateImportedSettings(payload);
      syncPlan();
      renderExercises();
      setTransferStatus(`Importiert: ${settings.exercises.length} Übungen · ${settings.rounds} Runden`);
      say('Workout-Konfiguration erfolgreich importiert.');
    } catch (_) {
      setTransferStatus('Datei konnte nicht importiert werden. Bitte eine gültige PULSE-JSON-Datei wählen.', true);
      say('Import der Workout-Konfiguration fehlgeschlagen.');
    }
  }
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
      // Full-scale signal with short fades to avoid clicks at either edge.
      gain.gain.linearRampToValueAtTime(1, start + .015);
      gain.gain.setValueAtTime(1, start + duration - .02);
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
  function halfwayRoundRestSound() {
    tone(920, .11);
    tone(920, .11, .18);
    if (navigator.vibrate) navigator.vibrate([70, 70, 70]);
    say('Hälfte der Rundenpause vorbei.');
  }
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || state.status !== 'running' || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (_) {}
  }
  function releaseWakeLock() { if (wakeLock) { const lock = wakeLock; wakeLock = null; lock.release().catch(() => {}); } }
  function applyPendingAppUpdate() {
    if (!swReloadPending || swReloading || state.status === 'running' || state.status === 'paused') return;
    swReloading = true;
    location.reload();
  }
  async function checkForAppUpdate() {
    if (!swRegistration || document.visibilityState !== 'visible') return;
    try { await swRegistration.update(); } catch (_) {}
    applyPendingAppUpdate();
  }
  function reloadForServiceWorkerUpdate() {
    if (!swHadController) {
      swHadController = true;
      return;
    }
    if (swReloading) return;
    if (state.status === 'running' || state.status === 'paused') {
      swReloadPending = true;
      return;
    }
    swReloading = true;
    location.reload();
  }
  async function registerServiceWorker() {
    try {
      swRegistration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
      await checkForAppUpdate();
    } catch (_) {}
  }
  function setSettingsOpen(open) {
    const panel = $('settingsPanel');
    const backdrop = $('settingsBackdrop');
    panel.hidden = !open;
    backdrop.hidden = !open;
    document.body.classList.toggle('settings-open', open);
    $('settingsBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      renderVoiceOptions();
      requestAnimationFrame(() => $('closeSettingsBtn').focus());
    } else if (document.activeElement === $('closeSettingsBtn')) {
      $('settingsBtn').focus();
    }
  }
  function setInputValues() {
    for (const [id, key] of Object.entries(numberFields)) $(id).value = settings[key];
    $('roundCount').textContent = settings.rounds;
    $('statWork').textContent = settings.work;
    $('statRest').textContent = settings.rest;
    $('statRounds').textContent = String(settings.rounds).padStart(2, '0');
    $('totalTime').innerHTML = `${formatTime(totalSeconds(plan))} <small>MIN</small>`;
    $('exerciseCount').textContent = `${settings.exercises.length} ${settings.exercises.length === 1 ? 'ÜBUNG' : 'ÜBUNGEN'}`;
    renderVoiceOptions();
    $('speechInput').checked = settings.speech;
    const speechAvailable = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    $('speechInput').disabled = !speechAvailable;
    $('speechHint').textContent = speechAvailable ? 'Deutsche Ansagen für Übungen und Pausen. Der Ton-Schalter schaltet auch die Stimme stumm.' : 'Sprachausgabe ist in diesem Browser nicht verfügbar.';
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
    state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1, halfCue: false };
    lastRenderedSecond = -1; saveSettings(); setInputValues(); renderTimer();
  }
  function setControlsDisabled() {
    const locked = state.status === 'running' || state.status === 'paused';
    Object.keys(numberFields).forEach(id => $(id).disabled = locked);
    ['minusRound', 'plusRound', 'addExerciseBtn', 'restoreBtn', 'importSettingsBtn'].forEach(id => $(id).disabled = locked);
    document.querySelectorAll('.exercise-input,.row-button').forEach(el => { el.disabled = locked || el.dataset.boundaryDisabled === 'true'; });
  }
  function markPhase(phase) {
    document.querySelector('.timer-panel').dataset.phase = phase;
    $('phaseText').textContent = phases[phase] || 'PAUSIERT';
  }
  const fittedTitles = new WeakMap();
  function fitExerciseTitles(force = false) {
    for (const element of [$('timer-heading'), $('nextText')]) {
      if (!force && fittedTitles.get(element) === element.textContent) continue;
      element.style.removeProperty('font-size');
      const maximum = parseFloat(getComputedStyle(element).fontSize);
      if (!element.clientWidth) continue;
      const range = document.createRange();
      range.selectNodeContents(element);
      const fits = size => {
        element.style.fontSize = `${size}px`;
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
        return element.scrollWidth <= element.clientWidth &&
          element.scrollHeight <= element.clientHeight &&
          range.getBoundingClientRect().height <= 2 * lineHeight + 1;
      };
      if (!fits(maximum)) {
        let low = 1;
        let high = maximum;
        for (let i = 0; i < 12; i++) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        fits(low);
      }
      fittedTitles.set(element, element.textContent);
    }
  }
  function renderTimer() {
    const complete = state.status === 'complete';
    const segment = complete ? null : plan[state.index];
    const kind = complete ? 'complete' : segment.kind;
    markPhase(kind);
    $('phaseText').textContent = state.status === 'paused' ? 'PAUSIERT' : phases[kind];
    $('timer-heading').textContent = complete ? 'Stark gemacht!' : segment.title;
    const next = complete ? null : upcomingWork(plan, state.index);
    const finalRoundRest = !complete && segment.kind === 'roundRest' && segment.round === settings.rounds;
    $('nextLabel').hidden = complete || (!finalRoundRest && !next);
    $('nextText').textContent = complete ? 'Dein Workout ist abgeschlossen.' : finalRoundRest ? 'Geschafft!' : next ? next.title : 'Letztes Intervall – zieh durch!';
    fitExerciseTitles();
    const exerciseTotal = settings.exercises.length;
    let exerciseNumber = exerciseTotal;
    if (!complete) {
      if (segment.kind === 'work') exerciseNumber = segment.exerciseIndex + 1;
      else if (segment.kind === 'rest') exerciseNumber = Math.min(exerciseTotal, segment.exerciseIndex + 2);
      else if (segment.kind === 'roundRest') exerciseNumber = segment.round === settings.rounds ? exerciseTotal : 1;
      else if (segment.kind === 'warmup') exerciseNumber = 1;
    }
    $('exerciseBadge').textContent = `ÜBUNG ${exerciseNumber} VON ${exerciseTotal}`;
    $('roundBadge').textContent = complete ? 'ALLE RUNDEN GESCHAFFT' : `RUNDE ${Math.max(1, segment.round)} VON ${settings.rounds}`;
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
      state.halfCue = false;
    }
    if (changed) {
      const phase = plan[state.index];
      phaseSound(phase.kind);
      say(`${phase.kind === 'rest' ? 'Pause' : phase.title}. ${phase.seconds} Sekunden.`);
    }
  }
  function tick() {
    if (state.status !== 'running') return;
    const now = Date.now();
    state.remainingMs = Math.max(0, state.deadline - now);
    if (state.remainingMs <= 0) advance(now);
    if (state.status !== 'running') return;
    const phase = plan[state.index];
    if (phase.kind === 'roundRest' && !state.halfCue && state.remainingMs > 0 && state.remainingMs <= phase.seconds * 500) {
      state.halfCue = true;
      halfwayRoundRestSound();
    }
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
      state.status = 'paused'; stopTick(); releaseWakeLock(); window.speechSynthesis?.cancel(); $('screenreaderUpdates').textContent = 'Pausiert.'; setControlsDisabled(); renderTimer(); return;
    }
    prepareAudio(); state.status = 'running'; state.deadline = Date.now() + state.remainingMs;
    state.lastCue = -1; acquireWakeLock(); startTick();
    say(`${plan[state.index].kind === 'rest' ? 'Pause' : plan[state.index].title}.`); setControlsDisabled(); renderTimer();
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
    state.halfCue = false;
    if (state.status === 'running') phaseSound(plan[target].kind);
    say(`${plan[target].kind === 'rest' ? 'Pause' : plan[target].title}.`);
    renderTimer();
  }
  function finish() {
    stopTick(); releaseWakeLock(); state.status = 'complete'; state.remainingMs = 0;
    phaseSound('complete'); say('Workout abgeschlossen. Stark gemacht!'); setControlsDisabled(); renderTimer();
  }
  function reset(announce = true) {
    window.speechSynthesis?.cancel();
    stopTick(); releaseWakeLock();
    state = { status: 'ready', index: 0, remainingMs: plan[0].seconds * 1000, deadline: 0, lastCue: -1, halfCue: false };
    lastRenderedSecond = -1; setControlsDisabled(); renderTimer();
    if (announce) say('Workout zurückgesetzt.');
    if (swReloadPending && !swReloading) {
      swReloading = true;
      location.reload();
    }
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
  $('exportSettingsBtn').addEventListener('click', exportSettings);
  $('importSettingsBtn').addEventListener('click', () => {
    setTransferStatus('');
    $('importSettingsFile').value = '';
    $('importSettingsFile').click();
  });
  $('importSettingsFile').addEventListener('change', event => importSettingsFile(event.target.files?.[0]));
  $('settingsBtn').addEventListener('click', () => setSettingsOpen(true));
  $('closeSettingsBtn').addEventListener('click', () => setSettingsOpen(false));
  $('settingsBackdrop').addEventListener('click', () => setSettingsOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('settingsPanel').hidden) setSettingsOpen(false);
  });
  $('speechVoice').addEventListener('change', event => {
    settings.speechVoice = event.target.value; saveSettings(); renderVoiceOptions();
    window.speechSynthesis?.cancel();
  });
  $('voicePreview').addEventListener('click', () => speak('Liegestütze. 40 Sekunden. Danach: Kniebeugen.'));
  window.speechSynthesis?.addEventListener('voiceschanged', renderVoiceOptions);
  $('speechInput').addEventListener('change', event => {
    settings.speech = event.target.checked; saveSettings(); renderVoiceOptions();
    window.speechSynthesis?.cancel();
    if (settings.speech) speak('Sprachausgabe aktiviert.');
  });
  $('soundBtn').addEventListener('click', () => { settings.sound = !settings.sound; if (!settings.sound) window.speechSynthesis?.cancel(); saveSettings(); setInputValues(); if (settings.sound) { prepareAudio(); tone(860, .15); } });
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
    if (document.visibilityState === 'visible') {
      if (state.status === 'running') { tick(); acquireWakeLock(); }
      checkForAppUpdate();
      applyPendingAppUpdate();
    }
  });
  window.addEventListener('pageshow', () => {
    if (state.status === 'running') tick();
    checkForAppUpdate();
    applyPendingAppUpdate();
  });
  window.addEventListener('beforeunload', releaseWakeLock);
  window.addEventListener('pagehide', () => window.speechSynthesis?.cancel());
  setInputValues(); renderExercises(); renderTimer();
  const titleResizeObserver = new ResizeObserver(() => fitExerciseTitles(true));
  titleResizeObserver.observe($('timer-heading'));
  titleResizeObserver.observe($('nextText'));
  document.fonts.ready.then(() => fitExerciseTitles(true));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.addEventListener('controllerchange', reloadForServiceWorkerUpdate);
    window.addEventListener('load', registerServiceWorker);
  }
})();
