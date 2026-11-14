(() => {
'use strict';
const BANK = window.LR_BANK;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// ?fast shortens every wait (only for automated tests).
const FAST = new URLSearchParams(location.search).has('fast') ? 0.05 : 1;
const sleep = ms => new Promise(r => setTimeout(r, ms * FAST));

const THEMES = ['Welcome', 'The place', 'Rules', 'Tasks', 'Closing'];
const ACCENTS = [
  { c: 'en-US', n: 'United States' },
  { c: 'en-GB', n: 'United Kingdom' },
  { c: 'en-AU', n: 'Australia' },
  { c: 'en-NZ', n: 'New Zealand' },
];
const RATES = [0.8, 1, 1.15, 1.3, 1.5];
const LENGTHS = [
  { c: 'long', n: 'Long' },
  { c: 'xl', n: 'Extra long' },
];
const accentName = c => (ACCENTS.find(a => a.c === c) || { n: c }).n;
const lengthName = c => (LENGTHS.find(a => a.c === c) || LENGTHS[0]).n;
const rateLabel = r => String(r) + '×';
// Seconds to answer each sentence. Extra-long sentences get a longer window.
const timesFor = len => [8, 8, 10, 10, 10].concat(len === 'xl' ? [15, 15] : [12, 12]);
const linesFor = (scene, k, len) => { const st = scene.sets[k]; return st.s.slice(0, 5).concat(len === 'xl' ? st.l : st.s.slice(5)); };

/* ---------- Local storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const cfg = Object.assign({ accent: 'en-US', rate: 1, len: 'xl', rec: true, voices: {} }, store.get('lr.cfg', {}));
let hist = store.get('lr.hist', []);
const saveCfg = () => store.set('lr.cfg', cfg);

/* ---------- Voices ---------- */
const hasTTS = 'speechSynthesis' in window;
let voices = [];
const norm = l => (l || '').replace('_', '-').toLowerCase();
const voicesFor = code => voices.filter(v => norm(v.lang) === code.toLowerCase());
// When the browser lists no voices, the accent is requested by language code alone (this is how Chrome on Android works).
const accentOK = code => voices.length === 0 ? code !== 'en-NZ' : voicesFor(code).length > 0;
function pickVoice(code) {
  const vs = voicesFor(code);
  if (!vs.length) return null;
  return vs.find(v => v.voiceURI === cfg.voices[code]) || vs.find(v => v.localService) || vs[0];
}
function refreshVoices() {
  if (!hasTTS) return;
  voices = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  renderSettings();
}
function resolveAccent() {
  if (cfg.accent !== 'mix') return cfg.accent;
  const ok = ACCENTS.filter(a => accentOK(a.c));
  return ok.length ? ok[Math.floor(Math.random() * ok.length)].c : 'en-US';
}

let utter = null; // keeps a reference so the browser does not drop the utterance halfway through
function speak(text, code, rate) {
  return new Promise(res => {
    if (!hasTTS) return res();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = code;
    const v = pickVoice(code);
    if (v) u.voice = v;
    u.rate = rate; u.pitch = 1; u.volume = 1;
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(guard); res(); };
    u.onend = fin; u.onerror = fin;
    const guard = setTimeout(fin, (text.split(/\s+/).length * 650 / rate + 4000) * FAST);
    utter = u;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/* ---------- Tone and microphone ---------- */
let actx = null;
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function beep() {
  const c = audioCtx();
  if (!c) return sleep(300);
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + 0.3);
  return sleep(320);
}
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const openMic = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
const closeMic = s => { if (s) s.getTracks().forEach(t => t.stop()); };
function startRec(stream) {
  let mr;
  try { mr = new MediaRecorder(stream); } catch (e) { return null; }
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { mr.onstop = () => r(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); });
  mr.start();
  return { stop() { if (mr.state !== 'inactive') mr.stop(); return stopped; } };
}

/* ---------- Views ---------- */
const VIEWS = ['home', 'run', 'review', 'history'];
function show(name) {
  VIEWS.forEach(v => { $('v-' + v).hidden = v !== name; });
  window.scrollTo(0, 0);
}
function artSVG(scene) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<svg class="art" viewBox="0 0 320 200" role="img" aria-label="' + scene.name + '">' + scene.art + '</svg>';
  return wrap.firstChild;
}

/* ---------- Home: settings ---------- */
function segButton(label, on, disabled, fn) {
  const b = el('button', null, label);
  b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(on));
  b.disabled = !!disabled;
  b.addEventListener('click', fn);
  return b;
}
function renderSettings() {
  const A = $('s-accent'); A.textContent = '';
  if (cfg.accent === 'en-NZ' && !accentOK('en-NZ')) cfg.accent = 'en-US';
  ACCENTS.forEach(a => {
    const ok = accentOK(a.c);
    if (a.c === 'en-NZ' && !ok) return;
    A.appendChild(segButton(a.n, cfg.accent === a.c, false, () => { cfg.accent = a.c; saveCfg(); renderSettings(); }));
  });
  A.appendChild(segButton('Surprise', cfg.accent === 'mix', false, () => { cfg.accent = 'mix'; saveCfg(); renderSettings(); }));
  const note = $('s-accent-note');
  if (!hasTTS) note.textContent = 'This browser cannot read text aloud. Open the page in Chrome.';
  else if (cfg.accent !== 'mix' && !accentOK(cfg.accent)) note.textContent = 'This device does not list an installed voice for this accent. Tap “Test the voice”: if it sounds the same as another accent, install the voice data in the device settings.';
  else if (!accentOK('en-NZ')) note.textContent = 'New Zealand is not available on this device; the closest accent is Australia. “Surprise” picks a different accent for each set.';
  else note.textContent = '“Surprise” picks a different accent for each set.';

  const R = $('s-rate'); R.textContent = '';
  RATES.forEach(r => R.appendChild(segButton(rateLabel(r), cfg.rate === r, false, () => { cfg.rate = r; saveCfg(); renderSettings(); })));

  const L = $('s-len'); L.textContent = '';
  if (!LENGTHS.some(x => x.c === cfg.len)) cfg.len = 'xl';
  LENGTHS.forEach(x => L.appendChild(segButton(x.n, cfg.len === x.c, false, () => { cfg.len = x.c; saveCfg(); renderSettings(); })));
  $('s-len-note').textContent = cfg.len === 'xl'
    ? 'Sentences 6 and 7 have 21 to 25 words, and you get 15 seconds to repeat each one.'
    : 'Sentences 6 and 7 have 14 to 19 words, and you get 12 seconds to repeat each one.';

  const vs = cfg.accent === 'mix' ? [] : voicesFor(cfg.accent);
  $('f-voice').hidden = vs.length < 2;
  const sel = $('s-voice'); sel.textContent = '';
  const cur = pickVoice(cfg.accent);
  vs.forEach(v => { const o = el('option', null, v.name); o.value = v.voiceURI; o.selected = !!cur && cur.voiceURI === v.voiceURI; sel.appendChild(o); });

  $('s-rec').checked = !!cfg.rec;
}

/* ---------- Home: scenes ---------- */
function bestFor(sceneId, k) {
  let done = false, best = null;
  hist.forEach(h => {
    if (h.s !== sceneId || h.k !== k) return;
    done = true;
    if (h.sc && h.sc.every(x => x != null)) { const t = h.sc.reduce((a, b) => a + b, 0); if (best == null || t > best) best = t; }
  });
  return { done, best };
}
function renderScenes() {
  const host = $('scenes'); host.textContent = '';
  BANK.scenes.forEach(scene => {
    const card = el('article', 'scene');
    card.appendChild(artSVG(scene));
    card.appendChild(el('h3', null, scene.name));
    const pills = el('div', 'pills');
    scene.sets.forEach((_, k) => {
      const st = bestFor(scene.id, k);
      const b = el('button', 'pill' + (st.done ? ' done' : ''));
      b.type = 'button';
      b.appendChild(document.createTextNode(String(k + 1)));
      b.appendChild(el('small', null, st.best != null ? st.best + '/35' : (st.done ? 'done' : THEMES[k])));
      b.setAttribute('aria-label', scene.name + ', set ' + (k + 1) + ', ' + THEMES[k] + (st.done ? ', already done' : ''));
      b.addEventListener('click', () => prepare(scene, k));
      pills.appendChild(b);
    });
    card.appendChild(pills);
    host.appendChild(card);
  });
}
function randomSet() {
  const all = [];
  BANK.scenes.forEach(s => s.sets.forEach((_, k) => all.push([s, k])));
  const fresh = all.filter(([s, k]) => !bestFor(s.id, k).done);
  const pool = fresh.length ? fresh : all;
  const [s, k] = pool[Math.floor(Math.random() * pool.length)];
  prepare(s, k);
}

/* ---------- Attempt ---------- */
let session = 0;      // changes when an attempt is cut short; every wait checks it
let cur = null;
let customImg = null;
let wake = null;
const CIRC = 326.73;

function setPhase(p, title, sub) {
  const ph = $('r-phase');
  ph.dataset.phase = p;
  $('r-title').textContent = title;
  $('r-sub').textContent = sub || '';
  $('r-steps').style.setProperty('--pc', p === 'speak' ? 'var(--speak)' : p === 'ready' ? 'var(--ready)' : 'var(--listen)');
}
function setRing(frac, num) {
  $('r-arc').style.strokeDashoffset = String(CIRC * (1 - frac));
  $('r-num').textContent = num == null ? '' : String(num);
}
function setStep(i) {
  const lis = $('r-steps').children;
  for (let j = 0; j < lis.length; j++) lis[j].className = j < i ? 'past' : j === i ? 'now' : '';
}
function paintArt() {
  const host = $('r-art'); host.textContent = '';
  if (customImg) { const im = new Image(); im.src = customImg; im.alt = 'Your picture'; host.appendChild(im); }
  else host.appendChild(artSVG(cur.scene));
}
function introText(scene) { return scene.role + ' Listen to ' + scene.who + ' and repeat what they say. Repeat only once.'; }

function prepare(scene, k) {
  stopAll();
  cur = { scene, k, code: resolveAccent(), rate: cfg.rate, len: cfg.len, lines: linesFor(scene, k, cfg.len), times: timesFor(cfg.len), blobs: Array(7).fill(null), urls: [], scores: Array(7).fill(null), rec: false };
  show('run');
  paintArt();
  $('r-meta').textContent = scene.name + ', set ' + (k + 1) + ' (' + THEMES[k] + '). Voice: ' + (cfg.accent === 'mix' ? 'surprise' : accentName(cur.code)) + ' at ' + rateLabel(cur.rate) + '. Sentences 6 and 7: ' + lengthName(cur.len).toLowerCase() + '.';
  $('r-context').textContent = introText(scene);
  const steps = $('r-steps'); steps.textContent = '';
  for (let i = 0; i < 7; i++) steps.appendChild(el('li'));
  setPhase('idle', 'Ready', 'Each sentence plays only once. After the tone, repeat it.');
  setRing(0, null);
  $('r-idle').hidden = false; $('r-live').hidden = true;
  $('r-note').textContent = cfg.rec ? 'When you start, the browser will ask for permission to use the microphone.' : 'Recording is off: the page only keeps the time.';
}

function countdown(sec, tok) {
  return new Promise(res => {
    const total = sec * 1000 * FAST, t0 = performance.now();
    (function tick() {
      if (tok !== session) return res();
      const left = Math.max(0, total - (performance.now() - t0));
      setRing(left / total, Math.ceil(left / 1000 / FAST));
      if (left <= 0) return res();
      requestAnimationFrame(tick);
    })();
  });
}

async function run() {
  const tok = ++session;
  const alive = () => tok === session;
  $('r-idle').hidden = true; $('r-live').hidden = false;
  audioCtx();
  try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) {}

  cur.rec = false;
  if (cfg.rec && canRecord()) {
    setPhase('ready', 'Microphone', 'Allow the permission to record your voice.');
    try { closeMic(await openMic()); cur.rec = true; } catch (e) { cur.rec = false; }
  }
  if (!alive()) return;
  $('r-note').textContent = cur.rec ? '' : (cfg.rec ? 'The microphone could not be used. The page keeps the time; to hear yourself, record with another app.' : '');

  setPhase('intro', 'Listen to the instructions', '');
  await sleep(400);
  await speak(introText(cur.scene), cur.code, cur.rate);
  if (!alive()) return;

  for (let i = 0; i < 7; i++) {
    setStep(i);
    setPhase('listen', 'Listen', 'Sentence ' + (i + 1) + ' of 7');
    await sleep(700);
    if (!alive()) return;
    await speak(cur.lines[i], cur.code, cur.rate);
    if (!alive()) return;

    setPhase('ready', 'Get ready', 'Wait for the tone');
    setRing(1, cur.times[i]);
    let stream = null;
    // The microphone opens only now, so that it does not lower the volume of the voice while the sentence plays.
    const mic = cur.rec ? openMic().then(s => { stream = s; }).catch(() => {}) : Promise.resolve();
    await Promise.all([sleep(2000), mic]);
    if (!alive()) { closeMic(stream); return; }
    await beep();

    const rec = stream ? startRec(stream) : null;
    setPhase('speak', 'Repeat now', rec ? 'Recording' : 'Not recording');
    await countdown(cur.times[i], tok);
    if (rec) { const b = await rec.stop(); if (alive() && b.size) cur.blobs[i] = b; }
    closeMic(stream);
    if (!alive()) return;
    await sleep(600);
  }
  releaseWake();
  openReview();
}
function releaseWake() { if (wake) { try { wake.release(); } catch (e) {} wake = null; } }
function stopAll() {
  session++;
  stopPlay();
  if (hasTTS) speechSynthesis.cancel();
  releaseWake();
}

/* ---------- Review ---------- */
const PLAY_ALL = 'Listen to all', STOP = 'Stop';
const player = new Audio();
let playTok = 0;
function stopPlay() {
  playTok++;
  if (hasTTS) speechSynthesis.cancel();
  player.pause();
  const b = $('b-playall'); if (b) b.textContent = PLAY_ALL;
  document.querySelectorAll('.rev li.playing').forEach(li => li.classList.remove('playing'));
}
function playBlob(i) {
  return new Promise(res => {
    const b = cur.blobs[i];
    if (!b) return res();
    if (!cur.urls[i]) cur.urls[i] = URL.createObjectURL(b);
    player.src = cur.urls[i];
    player.onended = res; player.onerror = res; player.onpause = res;
    player.play().catch(res);
  });
}
async function playAll() {
  if ($('b-playall').textContent === STOP) { stopPlay(); return; }
  stopPlay();
  const t = ++playTok;
  $('b-playall').textContent = STOP;
  const items = $('w-list').children;
  for (let i = 0; i < 7 && t === playTok; i++) {
    items[i].classList.add('playing');
    items[i].scrollIntoView({ block: 'nearest' });
    await speak(cur.lines[i], cur.code, cur.rate);
    if (t !== playTok) break;
    await sleep(350);
    await playBlob(i);
    if (t !== playTok) break;
    await sleep(450);
    items[i].classList.remove('playing');
  }
  if (t === playTok) stopPlay();
}
function renderTotal() {
  const got = cur.scores.filter(x => x != null);
  const sum = got.reduce((a, b) => a + b, 0);
  $('w-total').textContent = got.length === 7 ? 'Score: ' + sum + ' of 35' : got.length ? 'Partial score: ' + sum + ' of ' + got.length * 5 : 'No score yet';
}
function openReview() {
  show('review');
  const hasAudio = cur.blobs.some(Boolean);
  $('w-title').textContent = cur.scene.name + ', set ' + (cur.k + 1);
  $('w-meta').textContent = accentName(cur.code) + ' voice at ' + rateLabel(cur.rate) + '. ' + (hasAudio ? 'Compare each sentence with your recording.' : 'This attempt has no recording.');
  $('b-wav').hidden = !hasAudio;
  $('b-playall').textContent = PLAY_ALL;
  const list = $('w-list'); list.textContent = '';
  cur.lines.forEach((line, i) => {
    const li = el('li');
    li.appendChild(el('span', 'n', String(i + 1)));
    li.appendChild(el('p', 'txt', line));
    const ctl = el('div', 'ctl');
    const btns = el('div', 'rowbtns');
    const bo = el('button', 'btn', 'Original'); bo.type = 'button';
    bo.addEventListener('click', () => { stopPlay(); speak(line, cur.code, cur.rate); });
    btns.appendChild(bo);
    if (cur.blobs[i]) {
      const bm = el('button', 'btn', 'My answer'); bm.type = 'button';
      bm.addEventListener('click', () => { stopPlay(); playBlob(i); });
      btns.appendChild(bm);
    }
    ctl.appendChild(btns);
    const sc = el('div', 'score');
    sc.setAttribute('role', 'radiogroup'); sc.setAttribute('aria-label', 'Score for sentence ' + (i + 1));
    sc.appendChild(el('span', null, 'Score'));
    for (let n = 0; n <= 5; n++) {
      const b = el('button', null, String(n)); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', () => {
        cur.scores[i] = cur.scores[i] === n ? null : n;
        sc.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-checked', String(cur.scores[i] === j)));
        renderTotal();
      });
      sc.appendChild(b);
    }
    ctl.appendChild(sc);
    li.appendChild(ctl);
    list.appendChild(li);
  });
  renderTotal();
}
function dropAudio() { if (cur) { cur.urls.forEach(u => u && URL.revokeObjectURL(u)); cur.urls = []; } }

async function exportWav() {
  const c = audioCtx();
  if (!c) return;
  const parts = [];
  for (const b of cur.blobs) {
    if (!b) continue;
    try { parts.push(await c.decodeAudioData(await b.arrayBuffer())); } catch (e) {}
  }
  if (!parts.length) return;
  const sr = parts[0].sampleRate, step = sr >= 44100 ? 2 : 1, outSr = Math.round(sr / step), gap = Math.round(outSr * 0.6);
  let n = 0;
  parts.forEach(p => { n += Math.floor(p.length / step) + gap; });
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, outSr, true); dv.setUint32(28, outSr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  let o = 44;
  for (const p of parts) {
    const ch = [];
    for (let k = 0; k < p.numberOfChannels; k++) ch.push(p.getChannelData(k));
    const L = Math.floor(p.length / step);
    for (let i = 0; i < L; i++) {
      let s = 0;
      for (let j = 0; j < step; j++) for (const d of ch) s += d[i * step + j];
      s /= step * ch.length;
      dv.setInt16(o, Math.max(-1, Math.min(1, s)) * 32767, true); o += 2;
    }
    o += gap * 2;
  }
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  const a = document.createElement('a');
  const d = new Date(), pad = x => String(x).padStart(2, '0');
  a.href = url;
  a.download = 'listen-repeat_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + cur.scene.id + '-' + (cur.k + 1) + '.wav';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function saveAttempt() {
  hist.push({ t: Date.now(), s: cur.scene.id, k: cur.k, a: cur.code, r: cur.rate, l: cur.len, sc: cur.scores.slice(), rec: cur.blobs.some(Boolean) });
  store.set('lr.hist', hist);
}
function goHome() { stopAll(); dropAudio(); cur = null; renderScenes(); show('home'); }

/* ---------- History ---------- */
const CLEAR = 'Clear history';
function openHistory() {
  stopAll();
  const body = $('h-body'); body.textContent = '';
  const rows = hist.slice().reverse();
  $('h-empty').hidden = rows.length > 0;
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const full = [];
  rows.forEach(h => {
    const scene = BANK.scenes.find(s => s.id === h.s);
    const tr = el('tr');
    tr.appendChild(el('td', null, fmt.format(new Date(h.t))));
    tr.appendChild(el('td', null, (scene ? scene.name : h.s) + ', set ' + (h.k + 1)));
    tr.appendChild(el('td', null, accentName(h.a)));
    tr.appendChild(el('td', null, rateLabel(h.r)));
    tr.appendChild(el('td', null, lengthName(h.l)));
    const ok = h.sc && h.sc.every(x => x != null);
    const sum = ok ? h.sc.reduce((a, b) => a + b, 0) : null;
    if (ok) full.push(sum);
    tr.appendChild(el('td', null, ok ? sum + ' / 35' : 'no score'));
    body.appendChild(tr);
  });
  const last = full.slice(0, 5);
  $('h-sum').textContent = rows.length
    ? rows.length + (rows.length === 1 ? ' saved attempt.' : ' saved attempts.') + (last.length ? (last.length === 1 ? ' Last scored attempt: ' : ' Average of the last ' + last.length + ' scored attempts: ') + (last.reduce((a, b) => a + b, 0) / last.length).toFixed(1) + ' of 35.' : '')
    : '';
  $('b-clear').hidden = rows.length === 0;
  $('b-clear').textContent = CLEAR;
  show('history');
}

/* ---------- Events ---------- */
$('s-voice').addEventListener('change', e => { if (cfg.accent !== 'mix') { cfg.voices[cfg.accent] = e.target.value; saveCfg(); } });
$('s-rec').addEventListener('change', e => { cfg.rec = e.target.checked; saveCfg(); });
$('b-test').addEventListener('click', () => { audioCtx(); speak('This is how the voice sounds at this speed. Please repeat each sentence only once.', resolveAccent(), cfg.rate); });
$('b-random').addEventListener('click', randomSet);
$('b-hist').addEventListener('click', openHistory);
$('b-home').addEventListener('click', goHome);
$('b-start').addEventListener('click', () => { run(); });
$('b-back').addEventListener('click', goHome);
$('b-quit').addEventListener('click', () => { const s = cur.scene, k = cur.k; prepare(s, k); });
$('f-img').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (customImg) URL.revokeObjectURL(customImg);
  customImg = URL.createObjectURL(f);
  if (cur) paintArt();
});
$('b-playall').addEventListener('click', playAll);
$('b-wav').addEventListener('click', exportWav);
$('b-save').addEventListener('click', () => { saveAttempt(); goHome(); });
$('b-discard').addEventListener('click', goHome);
$('b-again').addEventListener('click', () => { const s = cur.scene, k = cur.k; saveAttempt(); dropAudio(); prepare(s, k); });
let clearArmed = 0;
$('b-clear').addEventListener('click', e => {
  if (Date.now() - clearArmed < 4000) { hist = []; store.set('lr.hist', hist); clearArmed = 0; openHistory(); return; }
  clearArmed = Date.now();
  e.target.textContent = 'Tap again to delete everything';
  setTimeout(() => { if (clearArmed && Date.now() - clearArmed >= 3900) { clearArmed = 0; e.target.textContent = CLEAR; } }, 4000);
});
// If the page is hidden during an attempt, the attempt stops: the timing would no longer match the exam.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cur && !$('v-run').hidden && !$('r-live').hidden) {
    const s = cur.scene, k = cur.k;
    prepare(s, k);
    $('r-note').textContent = 'The attempt stopped because you left the page. Start it again whenever you like.';
  }
});

/* ---------- Install and offline use ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('b-install').hidden = false; });
$('b-install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('b-install').hidden = true; });
function setStatus() {
  const n = BANK.scenes.reduce((a, s) => a + s.sets.length, 0);
  const off = navigator.serviceWorker && navigator.serviceWorker.controller;
  $('status').textContent = n + ' sets in the bank. ' + (off ? 'Saved on this device: it works offline.' : 'The first visit needs a connection; after that it works offline.');
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(setStatus).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', setStatus);
}

/* ---------- Start ---------- */
if (hasTTS) {
  speechSynthesis.onvoiceschanged = refreshVoices;
  [0, 300, 1200, 3000].forEach(ms => setTimeout(refreshVoices, ms));
}
renderSettings();
renderScenes();
setStatus();
show('home');
})();
