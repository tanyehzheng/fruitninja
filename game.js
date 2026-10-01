'use strict';

/* =====================================================================
 * FRUIT SLASH — a gesture-controlled Fruit Ninja style game
 * ---------------------------------------------------------------------
 * Everything runs in the browser. No build step, no server.
 *
 * Module map (all in this file, top to bottom):
 *   1. Constants & helpers        – fruit/difficulty/power-up/achievement tables, math utils
 *   2. AudioManager               – procedural sound effects via Web Audio API
 *   3. HandTracker                – webcam + MediaPipe Hands → index fingertip position
 *   4. SliceTrail                 – the glowing blade trail + the line segments used for hit tests
 *   5. Entities                   – Entity base, Fruit, FruitHalf, Bomb, PowerUp
 *   6. ParticleSystem             – juice particles, splatters, explosions, slashes, floating text
 *   7. StatsManager               – per-game + lifetime statistics, achievements (localStorage)
 *   8. UIManager                  – all DOM screens, HUD, toasts
 *   9. GameEngine                 – state machine, spawning, physics, collisions, rendering loop
 *  10. Bootstrap
 * ===================================================================== */


/* =====================================================================
 * 1. CONSTANTS & HELPERS
 * ===================================================================== */

const rand    = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp   = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp    = (a, b, t) => a + (b - a) * t;
const pick    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nowSec  = () => performance.now() / 1000;

const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
const UI_FONT    = '"Luckiest Guy", Impact, "Arial Black", sans-serif';

const STORAGE = {
  highScore:    'fruitslash.highscore.',   // + difficulty key
  stats:        'fruitslash.stats',
  achievements: 'fruitslash.achievements',
  muted:        'fruitslash.muted',
  difficulty:   'fruitslash.difficulty',
  camera:       'fruitslash.camera',
};

/** Fruit catalogue. `color` is the juice colour, `inner` the flesh colour shown on the cut face. */
const FRUIT_TYPES = {
  apple:      { emoji: '🍎', color: '#ff3b3b', inner: '#fff5c2', radius: 1.00, points: 10 },
  watermelon: { emoji: '🍉', color: '#ff4d6d', inner: '#ff7a8f', radius: 1.30, points: 15 },
  orange:     { emoji: '🍊', color: '#ff9f1c', inner: '#ffc46b', radius: 1.00, points: 10 },
  banana:     { emoji: '🍌', color: '#ffe066', inner: '#fff3b0', radius: 1.10, points: 12 },
  pineapple:  { emoji: '🍍', color: '#ffd43b', inner: '#fff0a0', radius: 1.25, points: 20 },
};
const FRUIT_KEYS = Object.keys(FRUIT_TYPES);

/** Difficulty presets. Timings in seconds; chances are per spawned item. */
const DIFFICULTY = {
  easy:   { label: 'Easy',   lives: 5, spawnInterval: 1.7, minInterval: 0.9,  bombChance: 0.05, maxBombChance: 0.14, missCostsLife: false, gravityMul: 0.9,  rampRate: 0.010,
            desc: '5 lives · missed fruit is free · fewer bombs' },
  normal: { label: 'Normal', lives: 3, spawnInterval: 1.4, minInterval: 0.6,  bombChance: 0.10, maxBombChance: 0.22, missCostsLife: true,  gravityMul: 1.0,  rampRate: 0.014,
            desc: '3 lives · missed fruit costs a life · the classic experience' },
  hard:   { label: 'Hard',   lives: 3, spawnInterval: 1.1, minInterval: 0.42, bombChance: 0.15, maxBombChance: 0.30, missCostsLife: true,  gravityMul: 1.15, rampRate: 0.018,
            desc: '3 lives · faster fruit · lots of bombs · for ninjas only' },
};

/** Power-ups that occasionally fly up alongside fruit. */
const POWERUPS = {
  slow:   { emoji: '⏳', label: 'SLOW-MO',  color: '#4dd0ff', duration: 6 },
  double: { emoji: '⭐', label: '2× SCORE', color: '#ffcc33', duration: 10 },
  life:   { emoji: '💖', label: '+1 LIFE',  color: '#ff6b9d', duration: 0 },
};

/** Achievements. `test(ctx)` receives { game, life } stats snapshots and returns true when unlocked. */
const ACHIEVEMENTS = [
  { id: 'first_blood',  icon: '🔪', name: 'First Blood',      desc: 'Slice your first fruit.',                 test: ({ life }) => life.slices >= 1 },
  { id: 'combo_3',      icon: '⚡', name: 'Triple Threat',    desc: 'Get a 3-fruit combo.',                    test: ({ game }) => game.bestCombo >= 3 },
  { id: 'combo_5',      icon: '🌪️', name: 'Whirlwind',        desc: 'Get a 5-fruit combo.',                    test: ({ game }) => game.bestCombo >= 5 },
  { id: 'combo_8',      icon: '🐉', name: 'Dragon Slash',     desc: 'Get an 8-fruit combo.',                   test: ({ game }) => game.bestCombo >= 8 },
  { id: 'score_500',    icon: '🥉', name: 'Apprentice',       desc: 'Score 500 points in one game.',           test: ({ game }) => game.score >= 500 },
  { id: 'score_1500',   icon: '🥈', name: 'Journeyman',       desc: 'Score 1,500 points in one game.',         test: ({ game }) => game.score >= 1500 },
  { id: 'score_3000',   icon: '🥇', name: 'Fruit Master',     desc: 'Score 3,000 points in one game.',         test: ({ game }) => game.score >= 3000 },
  { id: 'survive_120',  icon: '⏱️', name: 'Marathon',         desc: 'Survive for 2 minutes.',                  test: ({ game }) => game.playTime >= 120 },
  { id: 'pineapple_10', icon: '🍍', name: 'Spiky Business',   desc: 'Slice 10 pineapples in one game.',        test: ({ game }) => (game.byFruit.pineapple || 0) >= 10 },
  { id: 'untouchable',  icon: '🛡️', name: 'Untouchable',      desc: 'Reach 300 points without missing or hitting a bomb.', test: ({ game }) => game.score >= 300 && game.missed === 0 && game.bombsHit === 0 },
  { id: 'powered',      icon: '🔋', name: 'Power Hungry',     desc: 'Collect 3 power-ups in one game.',        test: ({ game }) => game.powerups >= 3 },
  { id: 'life_500',     icon: '🗡️', name: 'Veteran Blade',    desc: 'Slice 500 fruit in total.',               test: ({ life }) => life.slices >= 500 },
  { id: 'life_2000',    icon: '👑', name: 'Fruit Royalty',    desc: 'Slice 2,000 fruit in total.',             test: ({ life }) => life.slices >= 2000 },
  { id: 'games_10',     icon: '🎮', name: 'Regular',          desc: 'Play 10 games.',                          test: ({ life }) => life.games >= 10 },
];

/** Safe localStorage wrappers (private mode / blocked storage must never crash the game). */
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/** Distance test between line segment (x1,y1)-(x2,y2) and circle (cx,cy,r). */
function segCircleHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 > 0) t = clamp(((cx - x1) * dx + (cy - y1) * dy) / l2, 0, 1);
  const px = x1 + dx * t - cx;
  const py = y1 + dy * t - cy;
  return px * px + py * py <= r * r;
}

/** Draw an emoji centred on (x,y) with a given radius and rotation. */
function drawEmoji(ctx, emoji, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${Math.round(r * 2.05)}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, r * 0.08);   // small nudge: emoji glyphs sit slightly high on the "middle" baseline
  ctx.restore();
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}


/* =====================================================================
 * 2. AUDIO MANAGER — procedural SFX with the Web Audio API
 * ---------------------------------------------------------------------
 * No audio files: every sound is synthesised from oscillators and noise.
 * The AudioContext is created lazily on the first user gesture (browser
 * autoplay policy). All sounds route through a master gain for muting.
 * ===================================================================== */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = store.get(STORAGE.muted, false) === true;
    this.volume = 0.6;
  }

  /** Create the context. Must be called from a user gesture (click/tap). */
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    // 1 second of white noise, reused by every noisy sound
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  toggleMute() {
    this.muted = !this.muted;
    store.set(STORAGE.muted, this.muted);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  get ready() { return !!this.ctx && !this.muted; }

  /* ---- low-level builders ---- */

  /** Simple enveloped oscillator. */
  _tone({ freq, freqEnd = null, type = 'sine', start = 0, dur = 0.2, vol = 0.3, attack = 0.005 }) {
    const t0 = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Filtered noise burst. */
  _noise({ start = 0, dur = 0.2, vol = 0.3, filter = 'bandpass', freq = 1000, freqEnd = null, q = 1 }) {
    const t0 = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) flt.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---- game sounds ---- */

  /** Quick "swish + squelch" when a fruit is cut. Slight random pitch so repeats don't sound robotic. */
  slice() {
    if (!this.ready) return;
    const p = rand(0.9, 1.15);
    this._noise({ dur: 0.12, vol: 0.35, filter: 'bandpass', freq: 2600 * p, freqEnd: 500 * p, q: 0.8 });
    this._tone({ freq: 700 * p, freqEnd: 180 * p, type: 'triangle', dur: 0.14, vol: 0.18 });
  }

  /** Ascending pentatonic arpeggio; longer combos get more notes. */
  combo(count) {
    if (!this.ready) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5];
    const n = clamp(count, 3, scale.length);
    for (let i = 0; i < n; i++) {
      this._tone({ freq: scale[i], type: 'square', start: i * 0.055, dur: 0.18, vol: 0.12 });
      this._tone({ freq: scale[i] * 2, type: 'sine', start: i * 0.055, dur: 0.18, vol: 0.06 });
    }
  }

  /** Deep boom with crackle. */
  explosion() {
    if (!this.ready) return;
    this._noise({ dur: 0.7, vol: 0.6, filter: 'lowpass', freq: 900, freqEnd: 60, q: 0.5 });
    this._tone({ freq: 110, freqEnd: 28, type: 'sine', dur: 0.6, vol: 0.5 });
    this._tone({ freq: 60, freqEnd: 20, type: 'square', dur: 0.35, vol: 0.2 });
  }

  /** Missed fruit — short dull thud. */
  miss() {
    if (!this.ready) return;
    this._tone({ freq: 160, freqEnd: 70, type: 'sine', dur: 0.18, vol: 0.25 });
  }

  /** Power-up pickup — rising sparkle. */
  powerUp() {
    if (!this.ready) return;
    this._tone({ freq: 440, freqEnd: 1760, type: 'sine', dur: 0.35, vol: 0.2 });
    this._tone({ freq: 660, freqEnd: 2640, type: 'triangle', start: 0.05, dur: 0.3, vol: 0.12 });
  }

  /** Countdown beep; the final one is higher. */
  countdown(final = false) {
    if (!this.ready) return;
    this._tone({ freq: final ? 1320 : 880, type: 'square', dur: final ? 0.4 : 0.12, vol: 0.15 });
  }

  /** Descending minor phrase. */
  gameOver() {
    if (!this.ready) return;
    const notes = [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => {
      this._tone({ freq: f, type: 'sawtooth', start: i * 0.22, dur: 0.45, vol: 0.14 });
      this._tone({ freq: f / 2, type: 'triangle', start: i * 0.22, dur: 0.5, vol: 0.12 });
    });
  }

  /** Achievement unlocked — bright chime. */
  achievement() {
    if (!this.ready) return;
    [784, 988, 1175, 1568].forEach((f, i) => this._tone({ freq: f, type: 'sine', start: i * 0.08, dur: 0.4, vol: 0.12 }));
  }
}


/* =====================================================================
 * 3. HAND TRACKER — webcam + MediaPipe Hands
 * ---------------------------------------------------------------------
 * Opens the user's camera, feeds frames to MediaPipe and reports the
 * index-fingertip (landmark #8) as mirrored, normalised coordinates
 * (0..1). The caller maps those onto the canvas. Smoothing is applied
 * here to tame landmark jitter.
 * ===================================================================== */
class HandTracker {
  /**
   * @param {HTMLVideoElement} video
   * @param {{ onHand: Function, onStatus: Function }} callbacks
   *   onHand({ x, y, detected })  – x/y are mirrored normalised coords
   *   onStatus(text)              – progress messages for the UI
   */
  constructor(video, { onHand, onStatus }) {
    this.video = video;
    this.onHand = onHand;
    this.onStatus = onStatus || (() => {});
    this.hands = null;
    this.stream = null;
    this.running = false;
    this.busy = false;
    this.raf = 0;
    this.smooth = null;           // smoothed fingertip
    this.smoothing = 0.55;        // 0 = frozen, 1 = raw
    this.lastDetected = false;
    this.frames = 0;
  }

  get active() { return this.running; }

  /** Request the camera, load the model, start the detection loop. Throws a friendly Error on failure. */
  async start() {
    if (this.running) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser does not support camera access. Try Chrome, Edge or Firefox.');
    }
    if (typeof window.Hands === 'undefined') {
      throw new Error('Hand-tracking library failed to load. Check your internet connection and reload.');
    }

    this.onStatus('Requesting camera permission…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      throw new Error(HandTracker.describeCameraError(err));
    }

    this.video.srcObject = this.stream;
    await new Promise((resolve) => {
      if (this.video.readyState >= 1) return resolve();
      this.video.onloadedmetadata = () => resolve();
    });
    try { await this.video.play(); } catch { /* autoplay with muted video is allowed; ignore */ }

    this.onStatus('Loading hand-tracking model…');
    this.hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.55,
      selfieMode: false,           // we mirror manually so video + cursor stay consistent
    });
    this.hands.onResults((results) => this._onResults(results));

    try {
      if (typeof this.hands.initialize === 'function') await this.hands.initialize();
    } catch (err) {
      this.stop();
      throw new Error('Could not initialise the hand-tracking model. Check your connection and reload.');
    }

    this.running = true;
    this.onStatus('Camera ready!');
    this._loop();
  }

  /** Feed one frame at a time; skip frames while MediaPipe is still processing the previous one. */
  async _loop() {
    if (!this.running) return;
    if (!this.busy && this.video.readyState >= 2) {
      this.busy = true;
      try { await this.hands.send({ image: this.video }); }
      catch (err) { console.warn('[HandTracker] frame failed', err); }
      this.busy = false;
    }
    this.raf = requestAnimationFrame(() => this._loop());
  }

  _onResults(results) {
    this.frames++;
    const lm = results.multiHandLandmarks && results.multiHandLandmarks[0];
    if (!lm) {
      if (this.lastDetected) this.onHand({ detected: false });
      this.lastDetected = false;
      this.smooth = null;
      return;
    }
    const tip = lm[8];                       // index fingertip
    const raw = { x: 1 - tip.x, y: tip.y };  // mirror horizontally so moving right moves the cursor right
    if (!this.smooth) this.smooth = { ...raw };
    else {
      this.smooth.x = lerp(this.smooth.x, raw.x, this.smoothing);
      this.smooth.y = lerp(this.smooth.y, raw.y, this.smoothing);
    }
    this.lastDetected = true;
    this.onHand({ x: this.smooth.x, y: this.smooth.y, detected: true });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.hands && typeof this.hands.close === 'function') {
      try { this.hands.close(); } catch { /* ignore */ }
    }
    this.hands = null;
    this.video.srcObject = null;
  }

  /** Translate getUserMedia errors into something a player can act on. */
  static describeCameraError(err) {
    switch (err && err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Camera permission was denied. Allow camera access in your browser\'s address bar and try again.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No camera was found on this device.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'The camera is already in use by another application.';
      case 'OverconstrainedError':
        return 'The camera does not support the requested resolution.';
      case 'SecurityError':
        return 'Camera access is blocked on this page. Serve the game over http://localhost or https.';
      default:
        return `Could not start the camera (${err && err.message ? err.message : 'unknown error'}).`;
    }
  }
}


/* =====================================================================
 * 4. SLICE TRAIL
 * ---------------------------------------------------------------------
 * Stores recent pointer positions, draws a tapered glowing blade, and
 * hands new line segments to the engine for collision testing.
 * ===================================================================== */
class SliceTrail {
  constructor() {
    this.points = [];            // { x, y, t }
    this.pending = [];           // segments not yet collision-tested
    this.maxAge = 0.16;          // seconds a point stays visible
    this.color = '#ffffff';
    this.glow = '#4dd0ff';
  }

  addPoint(x, y, t) {
    const last = this.points[this.points.length - 1];
    if (last) {
      const len = Math.hypot(x - last.x, y - last.y);
      if (len < 1.5) { last.t = t; return; }               // ignore micro-jitter
      const dt = Math.max(1e-3, t - last.t);
      this.pending.push({ x1: last.x, y1: last.y, x2: x, y2: y, len, speed: len / dt });
    }
    this.points.push({ x, y, t });
    if (this.points.length > 40) this.points.shift();
  }

  /** Return and clear the segments created since the last call. */
  consumeSegments() {
    const s = this.pending;
    this.pending = [];
    return s;
  }

  /** Start a fresh stroke (finger lifted / hand lost). */
  break() {
    this.points.length = 0;
    this.pending.length = 0;
  }

  update(t) {
    while (this.points.length && t - this.points[0].t > this.maxAge) this.points.shift();
  }

  draw(ctx, t, baseWidth) {
    const pts = this.points;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Two passes: wide soft glow, then crisp white core. Width tapers from tail to head.
    const passes = [
      { color: this.glow, scale: 2.6, alpha: 0.35 },
      { color: this.color, scale: 1.0, alpha: 0.95 },
    ];
    for (const pass of passes) {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const age = clamp(1 - (t - p1.t) / this.maxAge, 0, 1);
        const taper = i / (pts.length - 1);
        ctx.strokeStyle = pass.color;
        ctx.globalAlpha = pass.alpha * age;
        ctx.lineWidth = Math.max(1, baseWidth * pass.scale * (0.2 + 0.8 * taper) * (0.4 + 0.6 * age));
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}


/* =====================================================================
 * 5. ENTITIES — Fruit, FruitHalf, Bomb, PowerUp
 * ===================================================================== */

/** Anything that flies: has position, velocity, radius, rotation and dies when it leaves the screen. */
class Entity {
  constructor(x, y, vx, vy, r) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.r = r;
    this.rot = rand(0, Math.PI * 2);
    this.rotSpeed = rand(-2.5, 2.5);
    this.gravityScale = 1;
    this.dead = false;
    this.age = 0;
  }

  update(dt, gravity) {
    this.vy += gravity * this.gravityScale * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.rotSpeed * dt;
    this.age += dt;
  }

  /** True once the entity has fallen below the bottom edge (after launch). */
  isBelowScreen(H) {
    return this.vy > 0 && this.y - this.r * 2 > H;
  }
}

class Fruit extends Entity {
  constructor(key, x, y, vx, vy, r) {
    super(x, y, vx, vy, r);
    this.key = key;
    this.type = FRUIT_TYPES[key];
    this.kind = 'fruit';
  }

  draw(ctx) {
    drawEmoji(ctx, this.type.emoji, this.x, this.y, this.r, this.rot);
  }

  /**
   * Split into two halves along the slice direction `angle` (radians).
   * Halves inherit the fruit's velocity plus a push perpendicular to the cut.
   */
  split(angle) {
    const nx = -Math.sin(angle), ny = Math.cos(angle);  // normal to the cut
    const halves = [];
    for (const side of [0, 1]) {
      const dir = side === 0 ? -1 : 1;
      const push = rand(90, 170);
      const h = new FruitHalf(this, side, angle);
      h.vx = this.vx * 0.7 + nx * dir * push;
      h.vy = this.vy * 0.5 + ny * dir * push - 80;
      h.rotSpeed = dir * rand(2, 6);
      halves.push(h);
    }
    return halves;
  }
}

/** One half of a sliced fruit. Rendered by clipping the emoji to one side of the cut line. */
class FruitHalf extends Entity {
  constructor(fruit, side, angle) {
    super(fruit.x, fruit.y, fruit.vx, fruit.vy, fruit.r);
    this.type = fruit.type;
    this.side = side;
    this.rot = fruit.rot;
    this.cutLocal = angle - fruit.rot;   // cut direction expressed in the fruit's own frame
    this.kind = 'half';
  }

  draw(ctx) {
    const R = this.r * 1.6;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.rotate(this.cutLocal);
    ctx.beginPath();
    if (this.side === 0) ctx.rect(-R, -R, R * 2, R);
    else ctx.rect(-R, 0, R * 2, R);
    ctx.clip();
    ctx.rotate(-this.cutLocal);
    drawEmoji(ctx, this.type.emoji, 0, 0, this.r, 0);

    // flesh showing along the cut
    ctx.rotate(this.cutLocal);
    ctx.fillStyle = this.type.inner;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * 0.92, this.r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Bomb: drawn entirely with canvas primitives (body, cap, fuse, flickering spark). */
class Bomb extends Entity {
  constructor(x, y, vx, vy, r) {
    super(x, y, vx, vy, r);
    this.kind = 'bomb';
    this.rotSpeed = rand(-1.5, 1.5);
  }

  draw(ctx, time) {
    const r = this.r;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);

    // body with glossy radial shading
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#6b6b70');
    g.addColorStop(0.5, '#2a2a2e');
    g.addColorStop(1, '#0a0a0c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.4, r * 0.22, r * 0.13, -0.7, 0, Math.PI * 2);
    ctx.fill();

    // skull mark
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.round(r * 0.9)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('☠', 0, r * 0.1);

    // cap
    ctx.fillStyle = '#8c8c94';
    ctx.beginPath();
    ctx.roundRect(-r * 0.26, -r * 1.12, r * 0.52, r * 0.3, r * 0.06);
    ctx.fill();

    // fuse
    ctx.strokeStyle = '#d9b98a';
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.1);
    ctx.quadraticCurveTo(r * 0.25, -r * 1.65, r * 0.65, -r * 1.5);
    ctx.stroke();

    // spark (flickers using time)
    const flick = 0.75 + 0.25 * Math.sin(time * 40 + this.x);
    const sx = r * 0.65, sy = -r * 1.5;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.45 * flick);
    sg.addColorStop(0, 'rgba(255,255,200,1)');
    sg.addColorStop(0.4, 'rgba(255,170,40,0.9)');
    sg.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.45 * flick, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Collectible power-up: emoji inside a pulsing ring. Slightly floaty physics. */
class PowerUp extends Entity {
  constructor(key, x, y, vx, vy, r) {
    super(x, y, vx, vy, r);
    this.key = key;
    this.type = POWERUPS[key];
    this.kind = 'powerup';
    this.gravityScale = 0.75;
    this.rotSpeed = rand(-1, 1);
  }

  draw(ctx, time) {
    const pulse = 1 + 0.08 * Math.sin(time * 6);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = this.type.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(3, this.r * 0.12);
    ctx.shadowColor = this.type.color;
    ctx.shadowBlur = this.r * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 1.05 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    drawEmoji(ctx, this.type.emoji, 0, 0, this.r * 0.8, this.rot * 0.3);
    ctx.restore();
  }
}


/* =====================================================================
 * 6. PARTICLE SYSTEM
 * ---------------------------------------------------------------------
 * Handles four kinds of ephemeral visuals:
 *   particles – juice drops, sparks, smoke (pooled plain objects)
 *   splats    – stains painted onto a persistent offscreen canvas that slowly fades
 *   slashes   – the bright line flash where a fruit was cut
 *   texts     – floating score / combo labels
 * ===================================================================== */
class ParticleSystem {
  constructor() {
    this.particles = [];
    this.slashes = [];
    this.texts = [];
    this.rings = [];
    this.splatCanvas = document.createElement('canvas');
    this.splatCtx = this.splatCanvas.getContext('2d');
    this.fadeAcc = 0;
    this.maxParticles = 600;
  }

  resize(W, H) {
    this.splatCanvas.width = Math.max(1, Math.floor(W));
    this.splatCanvas.height = Math.max(1, Math.floor(H));
  }

  clear() {
    this.particles.length = 0;
    this.slashes.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.splatCtx.clearRect(0, 0, this.splatCanvas.width, this.splatCanvas.height);
  }

  _add(p) {
    if (this.particles.length >= this.maxParticles) this.particles.shift();
    this.particles.push(p);
  }

  /** Juice droplets flying out from a slice, biased along the cut direction. */
  juice(x, y, color, angle, count = 18, scale = 1) {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-0.9, 0.9) + (Math.random() < 0.5 ? Math.PI : 0);
      const sp = rand(80, 420) * scale;
      this._add({
        x, y,
        vx: Math.cos(a) * sp + rand(-60, 60),
        vy: Math.sin(a) * sp + rand(-120, 20),
        life: rand(0.4, 0.9), maxLife: 0.9,
        size: rand(2, 6) * scale,
        color, gravity: 900, drag: 0.985, shape: 'circle',
      });
    }
  }

  /** Permanent-ish stain on the background layer. */
  splat(x, y, color, r) {
    const c = this.splatCtx;
    c.save();
    c.globalAlpha = 0.75;
    c.fillStyle = color;
    c.translate(x, y);
    c.rotate(rand(0, Math.PI * 2));
    c.beginPath();
    c.ellipse(0, 0, r * rand(0.7, 1), r * rand(0.45, 0.7), 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 7; i++) {
      const a = rand(0, Math.PI * 2), d = r * rand(0.6, 1.5);
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d, r * rand(0.08, 0.22), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** Bomb explosion: fire, sparks, smoke, and an expanding shock ring. */
  explosion(x, y, scale = 1) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(100, 650) * scale;
      this._add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 0.7), maxLife: 0.7,
        size: rand(3, 9) * scale,
        color: pick(['#fff3a0', '#ffb347', '#ff6a00', '#ff2d2d']),
        gravity: 300, drag: 0.96, shape: 'circle',
      });
    }
    for (let i = 0; i < 18; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(30, 160) * scale;
      this._add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.8, 1.4), maxLife: 1.4,
        size: rand(12, 26) * scale,
        color: pick(['rgba(60,60,60,0.6)', 'rgba(90,90,90,0.5)', 'rgba(30,30,30,0.6)']),
        gravity: -60, drag: 0.98, shape: 'smoke',
      });
    }
    this.rings.push({ x, y, r: 10, maxR: 260 * scale, life: 0.45, maxLife: 0.45, color: '#ffd27a' });
  }

  /** Glittery burst (power-ups, achievements). */
  sparkle(x, y, color, count = 24) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 320);
      this._add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.5, 1), maxLife: 1,
        size: rand(2, 5), color, gravity: 120, drag: 0.97, shape: 'star',
      });
    }
    this.rings.push({ x, y, r: 10, maxR: 160, life: 0.5, maxLife: 0.5, color });
  }

  /** A bright flash line along the cut. */
  slash(x1, y1, x2, y2) {
    this.slashes.push({ x1, y1, x2, y2, life: 0.14, maxLife: 0.14 });
  }

  /** Floating label. */
  text(x, y, str, { color = '#fff', size = 28, life = 0.9, vy = -70 } = {}) {
    this.texts.push({ x, y, str, color, size, life, maxLife: life, vy });
  }

  update(dt) {
    // particles
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.vy += p.gravity * dt;
      p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      if ((this.slashes[i].life -= dt) <= 0) this.slashes.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      r.r = lerp(r.maxR, 10, r.life / r.maxLife);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt;
    }

    // Fade splats gradually. Done in bursts so the 8-bit alpha rounding actually makes progress.
    this.fadeAcc += dt;
    if (this.fadeAcc > 0.12) {
      this.fadeAcc = 0;
      const c = this.splatCtx;
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,0.045)';
      c.fillRect(0, 0, this.splatCanvas.width, this.splatCanvas.height);
      c.restore();
    }
  }

  /** Background layer (splats) — drawn before entities. */
  drawBackground(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.splatCanvas, 0, 0);
    ctx.restore();
  }

  /** Foreground layer — drawn after entities. */
  drawForeground(ctx) {
    ctx.save();

    // shock rings
    for (const r of this.rings) {
      ctx.globalAlpha = (r.life / r.maxLife) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 6 * (r.life / r.maxLife) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // particles
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      if (p.shape === 'smoke') {
        ctx.globalAlpha = a * 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.5 - a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'star') {
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 10);
        ctx.fillRect(-p.size, -p.size * 0.25, p.size * 2, p.size * 0.5);
        ctx.fillRect(-p.size * 0.25, -p.size, p.size * 0.5, p.size * 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // slashes
    ctx.lineCap = 'round';
    for (const s of this.slashes) {
      const a = s.life / s.maxLife;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 + 10 * a;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 20 * a;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // floating text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      const scale = 1 + (1 - a) * 0.25;
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.font = `${Math.round(t.size * scale)}px ${UI_FONT}`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineJoin = 'round';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }

    ctx.restore();
  }
}


/* =====================================================================
 * 7. STATS MANAGER — per-game stats, lifetime stats, achievements
 * ===================================================================== */
class StatsManager {
  constructor() {
    this.life = Object.assign({
      games: 0, slices: 0, missed: 0, bombsHit: 0, bestCombo: 0,
      playTime: 0, powerups: 0, highestScore: 0,
    }, store.get(STORAGE.stats, {}));
    this.unlocked = new Set(store.get(STORAGE.achievements, []));
    this.game = this.freshGame();
  }

  freshGame() {
    return { score: 0, slices: 0, missed: 0, bombsHit: 0, bestCombo: 0, playTime: 0, powerups: 0, byFruit: {} };
  }

  startGame() {
    this.game = this.freshGame();
    this.life.games++;
    this.save();
  }

  recordSlice(key) {
    this.game.slices++;
    this.life.slices++;
    this.game.byFruit[key] = (this.game.byFruit[key] || 0) + 1;
  }
  recordMiss()     { this.game.missed++;   this.life.missed++; }
  recordBomb()     { this.game.bombsHit++; this.life.bombsHit++; }
  recordPowerUp()  { this.game.powerups++; this.life.powerups++; }
  recordCombo(n)   { this.game.bestCombo = Math.max(this.game.bestCombo, n); this.life.bestCombo = Math.max(this.life.bestCombo, n); }
  addTime(dt)      { this.game.playTime += dt; this.life.playTime += dt; }
  setScore(s)      { this.game.score = s; this.life.highestScore = Math.max(this.life.highestScore, s); }

  /** Accuracy = fruit sliced / fruit that could have been sliced. */
  accuracy(stats = this.game) {
    const total = stats.slices + stats.missed;
    return total === 0 ? 0 : Math.round((stats.slices / total) * 100);
  }

  /** Check every locked achievement; return the newly unlocked definitions. */
  checkAchievements() {
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      let ok = false;
      try { ok = a.test({ game: this.game, life: this.life }); } catch { ok = false; }
      if (ok) { this.unlocked.add(a.id); newly.push(a); }
    }
    if (newly.length) this.save();
    return newly;
  }

  save() {
    store.set(STORAGE.stats, this.life);
    store.set(STORAGE.achievements, [...this.unlocked]);
  }

  reset() {
    this.life = { games: 0, slices: 0, missed: 0, bombsHit: 0, bestCombo: 0, playTime: 0, powerups: 0, highestScore: 0 };
    this.unlocked.clear();
    this.save();
    for (const k of Object.keys(DIFFICULTY)) store.remove(STORAGE.highScore + k);
  }
}


/* =====================================================================
 * 8. UI MANAGER — DOM screens, HUD, toasts
 * ---------------------------------------------------------------------
 * The engine never touches the DOM directly; it calls these methods.
 * Button clicks are forwarded to engine callbacks registered via `on`.
 * ===================================================================== */
class UIManager {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), score: $('score'), hiscore: $('hiscore'), combo: $('combo'),
      powerups: $('powerups'), lives: $('lives'), handStatus: $('hand-status'),
      btnPause: $('btn-pause'), btnMute: $('btn-mute'), btnCam: $('btn-cam'),
      screens: {
        start: $('screen-start'), countdown: $('screen-countdown'), pause: $('screen-pause'),
        gameover: $('screen-gameover'), stats: $('screen-stats'), achievements: $('screen-achievements'),
      },
      countdownNumber: $('countdown-number'),
      difficulty: $('difficulty'), difficultyDesc: $('difficulty-desc'),
      startStatus: $('start-status'),
      btnStartHand: $('btn-start-hand'), btnStartTouch: $('btn-start-touch'),
      btnStats: $('btn-stats'), btnAchievements: $('btn-achievements'),
      btnResume: $('btn-resume'), btnQuit: $('btn-quit'),
      btnRestart: $('btn-restart'), btnMenu: $('btn-menu'),
      btnStatsBack: $('btn-stats-back'), btnResetStats: $('btn-reset-stats'),
      btnAchievementsBack: $('btn-achievements-back'),
      newbest: $('newbest'), finalScore: $('final-score'), finalBest: $('final-best'), finalStats: $('final-stats'),
      statsGrid: $('stats-grid'), achievementList: $('achievement-list'), achievementCount: $('achievement-count'),
      toasts: $('toast-container'), flash: $('flash'),
    };
    this.handlers = {};
    this.lastScore = -1;
    this.comboTimeout = 0;

    // Wire buttons → named events
    const bind = (btn, name) => btn.addEventListener('click', (e) => { e.preventDefault(); this.emit(name); });
    bind(this.el.btnStartHand, 'startHand');
    bind(this.el.btnStartTouch, 'startTouch');
    bind(this.el.btnStats, 'showStats');
    bind(this.el.btnAchievements, 'showAchievements');
    bind(this.el.btnResume, 'resume');
    bind(this.el.btnQuit, 'quit');
    bind(this.el.btnRestart, 'restart');
    bind(this.el.btnMenu, 'quit');
    bind(this.el.btnStatsBack, 'backToMenu');
    bind(this.el.btnAchievementsBack, 'backToMenu');
    bind(this.el.btnResetStats, 'resetStats');
    bind(this.el.btnPause, 'togglePause');
    bind(this.el.btnMute, 'toggleMute');
    bind(this.el.btnCam, 'toggleCamera');

    this.el.difficulty.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      this.setDifficulty(b.dataset.value);
      this.emit('difficulty', b.dataset.value);
    });
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  emit(name, ...args) { if (this.handlers[name]) this.handlers[name](...args); }

  /* ---- screens ---- */
  showScreen(name) {
    for (const [k, s] of Object.entries(this.el.screens)) s.classList.toggle('hidden', k !== name);
  }
  hideScreens() { this.showScreen(null); }
  showHUD(show) { this.el.hud.classList.toggle('hidden', !show); }

  setDifficulty(key) {
    for (const b of this.el.difficulty.querySelectorAll('button')) b.classList.toggle('active', b.dataset.value === key);
    this.el.difficultyDesc.textContent = DIFFICULTY[key].desc;
  }

  setStartStatus(text, isError = false) {
    this.el.startStatus.textContent = text || '';
    this.el.startStatus.classList.toggle('error', isError);
  }
  setStartButtonsEnabled(enabled) {
    this.el.btnStartHand.disabled = !enabled;
    this.el.btnStartTouch.disabled = !enabled;
  }

  /** Re-trigger the CSS pop animation for each number. */
  showCountdown(text) {
    this.showScreen('countdown');
    const n = this.el.countdownNumber;
    n.textContent = text;
    n.style.animation = 'none';
    void n.offsetWidth;   // reflow to restart the animation
    n.style.animation = '';
  }

  /* ---- HUD ---- */
  updateScore(score, high) {
    if (score !== this.lastScore) {
      this.el.score.textContent = score.toLocaleString();
      this.el.score.classList.remove('bump');
      void this.el.score.offsetWidth;
      this.el.score.classList.add('bump');
      this.lastScore = score;
    }
    this.el.hiscore.textContent = `BEST ${high.toLocaleString()}`;
  }

  updateLives(lives, max) {
    const full = Math.max(lives, 0);
    const empty = Math.max(0, max - full);
    this.el.lives.textContent = '❤️'.repeat(full) + '🖤'.repeat(empty);
  }

  showCombo(n) {
    clearTimeout(this.comboTimeout);
    this.el.combo.textContent = `${n}× COMBO`;
    this.el.combo.classList.add('show');
    this.comboTimeout = setTimeout(() => this.el.combo.classList.remove('show'), 700);
  }

  /** @param {Array<{label,color,remaining}>} active */
  updatePowerups(active) {
    this.el.powerups.innerHTML = active
      .map((p) => `<span class="powerup-chip" style="color:${p.color}">${p.label} ${p.remaining.toFixed(1)}s</span>`)
      .join('');
  }

  setMuted(muted) { this.el.btnMute.textContent = muted ? '🔇' : '🔊'; }
  setCamera(on)   { this.el.btnCam.style.opacity = on ? '1' : '0.45'; }
  setPaused(p)    { this.el.btnPause.textContent = p ? '▶' : '⏸'; }

  setHandStatus(mode, detected) {
    const el = this.el.handStatus;
    if (mode !== 'hand') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.classList.toggle('lost', !detected);
    el.textContent = detected ? '🖐 Tracking' : '🔍 Show your hand to the camera';
  }

  flash(color = '#ff2d2d') {
    const f = this.el.flash;
    f.style.background = color;
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }

  /* ---- end-of-game & info screens ---- */
  statCard(k, v) { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

  showGameOver({ score, high, isNewBest, game, accuracy }) {
    this.el.finalScore.textContent = score.toLocaleString();
    this.el.finalBest.textContent = `BEST ${high.toLocaleString()}`;
    this.el.newbest.classList.toggle('hidden', !isNewBest);
    this.el.finalStats.innerHTML =
      this.statCard('Fruit sliced', game.slices) +
      this.statCard('Best combo', game.bestCombo ? `${game.bestCombo}×` : '—') +
      this.statCard('Accuracy', `${accuracy}%`) +
      this.statCard('Time', formatTime(game.playTime)) +
      this.statCard('Bombs hit', game.bombsHit) +
      this.statCard('Power-ups', game.powerups);
    this.showScreen('gameover');
  }

  showStats(stats, highScores) {
    const life = stats.life, game = stats.game;
    const section = (t) => `<div class="stat-section">${t}</div>`;
    this.el.statsGrid.innerHTML =
      section('LIFETIME') +
      this.statCard('Games played', life.games) +
      this.statCard('Total slices', life.slices.toLocaleString()) +
      this.statCard('Fruit missed', life.missed.toLocaleString()) +
      this.statCard('Accuracy', `${stats.accuracy(life)}%`) +
      this.statCard('Best combo', life.bestCombo ? `${life.bestCombo}×` : '—') +
      this.statCard('Bombs hit', life.bombsHit) +
      this.statCard('Power-ups', life.powerups) +
      this.statCard('Play time', formatTime(life.playTime)) +
      section('HIGH SCORES') +
      Object.keys(DIFFICULTY).map((k) => this.statCard(DIFFICULTY[k].label, (highScores[k] || 0).toLocaleString())).join('') +
      section('LAST GAME') +
      this.statCard('Score', game.score.toLocaleString()) +
      this.statCard('Slices', game.slices) +
      this.statCard('Best combo', game.bestCombo ? `${game.bestCombo}×` : '—') +
      this.statCard('Time', formatTime(game.playTime));
    this.showScreen('stats');
  }

  showAchievements(unlocked) {
    this.el.achievementCount.textContent = `${unlocked.size} / ${ACHIEVEMENTS.length} unlocked`;
    this.el.achievementList.innerHTML = ACHIEVEMENTS.map((a) => `
      <div class="achievement ${unlocked.has(a.id) ? '' : 'locked'}">
        <div class="icon">${a.icon}</div>
        <div><div class="name">${a.name}</div><div class="desc">${a.desc}</div></div>
      </div>`).join('');
    this.showScreen('achievements');
  }

  toast(achievement) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div class="icon">${achievement.icon}</div><div><div class="title">ACHIEVEMENT UNLOCKED</div><div class="name">${achievement.name}</div></div>`;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3700);
  }
}


/* =====================================================================
 * 9. GAME ENGINE
 * ---------------------------------------------------------------------
 * Owns the canvas, the state machine (menu → countdown → playing ⇄ paused
 * → gameover), spawning, physics, slicing, scoring, power-ups and the
 * render loop. Input arrives from either the HandTracker or pointer
 * events, normalised into `this.pointer`.
 * ===================================================================== */
class GameEngine {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.video = document.getElementById('webcam');

    this.audio = new AudioManager();
    this.ui = new UIManager();
    this.stats = new StatsManager();
    this.particles = new ParticleSystem();
    this.trail = new SliceTrail();
    this.tracker = new HandTracker(this.video, {
      onHand: (h) => this.onHand(h),
      onStatus: (s) => this.ui.setStartStatus(s),
    });

    // Display
    this.W = 0; this.H = 0; this.dpr = 1;
    this.unit = 0;            // min(W,H) — used for responsive sizing
    this.bgCanvas = document.createElement('canvas');
    this.showCamera = store.get(STORAGE.camera, true) !== false;

    // State
    this.state = 'menu';      // menu | countdown | playing | paused | gameover
    this.difficultyKey = store.get(STORAGE.difficulty, 'normal');
    if (!DIFFICULTY[this.difficultyKey]) this.difficultyKey = 'normal';
    this.diff = DIFFICULTY[this.difficultyKey];
    this.inputMode = 'touch'; // 'hand' | 'touch'
    this.countdownTimers = [];

    // Input
    this.pointer = { x: 0, y: 0, active: false };
    this.pointerTarget = { x: 0, y: 0 };
    this.handDetected = false;
    this.handLostTime = 0;

    // Round data (reset in startRound)
    this.items = [];          // Fruit | Bomb | PowerUp
    this.halves = [];         // FruitHalf
    this.launchQueue = [];    // delayed launches within a wave
    this.score = 0;
    this.lives = 3;
    this.maxLives = 3;
    this.elapsed = 0;         // game-time seconds (scaled by slow-mo)
    this.realElapsed = 0;
    this.spawnTimer = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.lastSlice = { x: 0, y: 0 };
    this.timeScale = 1;
    this.scoreMult = 1;
    this.activePowerups = {}; // key → remaining seconds
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.highScore = this.loadHighScore();
    this.lastFrame = nowSec();
    this.time = 0;            // total render time, for animations

    this.bindUI();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.ui.setDifficulty(this.difficultyKey);
    this.ui.setMuted(this.audio.muted);
    this.ui.setCamera(this.showCamera);
    this.ui.updateScore(0, this.highScore);
    this.ui.showScreen('start');

    requestAnimationFrame(() => this.frame());
  }

  /* ---------------- setup ---------------- */

  loadHighScore() { return store.get(STORAGE.highScore + this.difficultyKey, 0) || 0; }

  bindUI() {
    this.ui
      .on('startHand',  () => this.startWithHand())
      .on('startTouch', () => this.startWithTouch())
      .on('restart',    () => this.restart())
      .on('resume',     () => this.resume())
      .on('quit',       () => this.quitToMenu())
      .on('backToMenu', () => this.ui.showScreen('start'))
      .on('togglePause',() => this.togglePause())
      .on('toggleMute', () => this.ui.setMuted(this.audio.toggleMute()))
      .on('toggleCamera', () => this.toggleCamera())
      .on('showStats',  () => this.ui.showStats(this.stats, this.allHighScores()))
      .on('showAchievements', () => this.ui.showAchievements(this.stats.unlocked))
      .on('resetStats', () => {
        if (confirm('Reset all statistics, achievements and high scores?')) {
          this.stats.reset();
          this.highScore = 0;
          this.ui.updateScore(0, 0);
          this.ui.showStats(this.stats, this.allHighScores());
        }
      })
      .on('difficulty', (key) => {
        this.difficultyKey = key;
        this.diff = DIFFICULTY[key];
        store.set(STORAGE.difficulty, key);
        this.highScore = this.loadHighScore();
        this.ui.updateScore(0, this.highScore);
      });

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      switch (e.key.toLowerCase()) {
        case 'p': case 'escape': this.togglePause(); break;
        case 'm': this.ui.setMuted(this.audio.toggleMute()); break;
        case 'c': this.toggleCamera(); break;
      }
    });

    // Auto-pause when the tab is hidden so the player doesn't lose lives in the background
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  /** Touch / mouse fallback (and also works alongside hand tracking). */
  bindInput() {
    const c = this.canvas;
    const pos = (e) => ({ x: e.clientX, y: e.clientY });
    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'playing') return;
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.pointerTarget = p;
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.active = true;
      this.trail.break();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointer.active || this.inputMode === 'hand') return;
      this.pointerTarget = pos(e);
    });
    const release = () => {
      if (this.inputMode === 'hand') return;
      this.pointer.active = false;
      this.trail.break();
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('pointerleave', release);
  }

  /** Hi-DPI aware resize. Everything is drawn in CSS pixels; the backing store is scaled by DPR. */
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.unit = Math.min(this.W, this.H);
    this.particles.resize(this.W, this.H);
    this.buildBackground();
  }

  /** Pre-render the static background gradient + vignette once. */
  buildBackground() {
    const c = this.bgCanvas;
    c.width = this.W; c.height = this.H;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(this.W * 0.3, this.H * 0.2, 0, this.W * 0.5, this.H * 0.5, Math.max(this.W, this.H) * 0.9);
    grad.addColorStop(0, '#2b1650');
    grad.addColorStop(0.6, '#140b2e');
    grad.addColorStop(1, '#070416');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.W, this.H);

    // subtle diagonal wood-like stripes for an arcade "cutting board" feel
    g.save();
    g.globalAlpha = 0.05;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    for (let i = -this.H; i < this.W + this.H; i += 36) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + this.H, this.H); g.stroke();
    }
    g.restore();

    // vignette
    const v = g.createRadialGradient(this.W / 2, this.H / 2, this.unit * 0.3, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, this.W, this.H);
  }

  get baseRadius() { return clamp(this.unit * 0.058, 26, 64); }
  get gravity()    { return this.H * 0.8 * this.diff.gravityMul; }

  allHighScores() {
    const o = {};
    for (const k of Object.keys(DIFFICULTY)) o[k] = store.get(STORAGE.highScore + k, 0) || 0;
    return o;
  }

  /* ---------------- input ---------------- */

  /** Map the tracker's normalised (mirrored) coordinates onto the canvas using the same "cover" fit as the camera preview. */
  onHand(h) {
    if (this.inputMode !== 'hand') return;
    if (!h.detected) {
      if (this.handDetected) { this.trail.break(); }
      this.handDetected = false;
      this.pointer.active = false;
      this.ui.setHandStatus('hand', false);
      return;
    }
    const fit = this.cameraFit();
    const x = fit.x + h.x * fit.w;
    const y = fit.y + h.y * fit.h;
    if (!this.handDetected) {
      // first detection after a gap — jump the cursor instead of sweeping across the screen
      this.pointer.x = x; this.pointer.y = y;
      this.trail.break();
      this.ui.setHandStatus('hand', true);
    }
    this.handDetected = true;
    this.pointerTarget = { x, y };
    this.pointer.active = this.state === 'playing';
  }

  /** How the 4:3 (or whatever) camera frame maps onto the canvas: scaled to cover, centred. */
  cameraFit() {
    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    const s = Math.max(this.W / vw, this.H / vh);
    const w = vw * s, h = vh * s;
    return { x: (this.W - w) / 2, y: (this.H - h) / 2, w, h };
  }

  toggleCamera() {
    this.showCamera = !this.showCamera;
    store.set(STORAGE.camera, this.showCamera);
    this.ui.setCamera(this.showCamera);
  }

  /* ---------------- state transitions ---------------- */

  async startWithHand() {
    this.audio.init();
    this.ui.setStartButtonsEnabled(false);
    this.ui.setStartStatus('Starting camera…');
    try {
      await this.tracker.start();
      this.inputMode = 'hand';
      this.ui.setStartStatus('');
      this.ui.setStartButtonsEnabled(true);
      this.beginCountdown();
    } catch (err) {
      console.error(err);
      this.ui.setStartButtonsEnabled(true);
      this.ui.setStartStatus(`${err.message} You can still play with touch / mouse.`, true);
    }
  }

  startWithTouch() {
    this.audio.init();
    this.inputMode = 'touch';
    this.ui.setStartStatus('');
    this.beginCountdown();
  }

  restart() {
    this.audio.init();
    // Stay in hand mode only if the camera is still running
    if (this.inputMode === 'hand' && !this.tracker.active) this.inputMode = 'touch';
    this.beginCountdown();
  }

  /** 3 · 2 · 1 · GO! then the round starts. */
  beginCountdown() {
    this.clearCountdown();
    this.resetRound();
    this.state = 'countdown';
    this.ui.showHUD(true);
    this.ui.setHandStatus(this.inputMode, this.handDetected);
    const steps = ['3', '2', '1', 'GO!'];
    steps.forEach((s, i) => {
      this.countdownTimers.push(setTimeout(() => {
        this.ui.showCountdown(s);
        this.audio.countdown(s === 'GO!');
        if (s === 'GO!') this.countdownTimers.push(setTimeout(() => this.startRound(), 600));
      }, i * 800));
    });
  }

  clearCountdown() {
    this.countdownTimers.forEach(clearTimeout);
    this.countdownTimers.length = 0;
  }

  resetRound() {
    this.items.length = 0;
    this.halves.length = 0;
    this.launchQueue.length = 0;
    this.particles.clear();
    this.trail.break();
    this.score = 0;
    this.maxLives = this.diff.lives;
    this.lives = this.diff.lives;
    this.elapsed = 0;
    this.realElapsed = 0;
    this.spawnTimer = 0.8;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.timeScale = 1;
    this.scoreMult = 1;
    this.activePowerups = {};
    this.shake = 0;
    this.highScore = this.loadHighScore();
    this.ui.updateScore(0, this.highScore);
    this.ui.updateLives(this.lives, this.maxLives);
    this.ui.updatePowerups([]);
  }

  startRound() {
    this.stats.startGame();
    this.state = 'playing';
    this.ui.hideScreens();
    this.ui.setPaused(false);
    this.lastFrame = nowSec();
    if (this.inputMode === 'hand') this.pointer.active = this.handDetected;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.setPaused(true);
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.resume();
    this.state = 'playing';
    this.ui.setPaused(false);
    this.ui.hideScreens();
    this.trail.break();
    this.lastFrame = nowSec();
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  quitToMenu() {
    this.clearCountdown();
    this.state = 'menu';
    this.pointer.active = false;
    this.ui.showHUD(false);
    this.ui.setHandStatus(null);
    this.ui.showScreen('start');
    this.resetRound();
  }

  gameOver() {
    this.state = 'gameover';
    this.pointer.active = false;
    this.trail.break();
    this.audio.gameOver();
    this.stats.setScore(this.score);

    const isNewBest = this.score > this.highScore && this.score > 0;
    if (isNewBest) {
      this.highScore = this.score;
      store.set(STORAGE.highScore + this.difficultyKey, this.score);
    }
    this.stats.save();
    this.unlockAchievements();

    setTimeout(() => {
      if (this.state !== 'gameover') return;
      this.ui.showGameOver({
        score: this.score, high: this.highScore, isNewBest,
        game: this.stats.game, accuracy: this.stats.accuracy(),
      });
    }, 900);
  }

  unlockAchievements() {
    const newly = this.stats.checkAchievements();
    if (!newly.length) return;
    this.audio.achievement();
    newly.forEach((a, i) => setTimeout(() => this.ui.toast(a), i * 500));
  }

  /* ---------------- spawning ---------------- */

  /** Difficulty curve: shorter gaps, bigger waves and more bombs as time passes. */
  get currentSpawnInterval() {
    return Math.max(this.diff.minInterval, this.diff.spawnInterval - this.elapsed * this.diff.rampRate);
  }
  get currentBombChance() {
    return Math.min(this.diff.maxBombChance, this.diff.bombChance + this.elapsed * 0.0015);
  }

  spawnWave() {
    const t = this.elapsed;
    const base = 1 + Math.floor(t / 20);
    const count = clamp(base + (Math.random() < 0.35 ? 1 : 0), 1, 5);
    for (let i = 0; i < count; i++) {
      let kind = 'fruit';
      const roll = Math.random();
      if (roll < this.currentBombChance) kind = 'bomb';
      else if (t > 8 && roll > 0.955) kind = 'powerup';
      this.launchQueue.push({ at: i * rand(0.08, 0.2), kind });
    }
  }

  /** Create one flying item at the bottom edge with a trajectory that peaks somewhere on screen. */
  launch(kind) {
    const W = this.W, H = this.H, g = this.gravity;
    let r = this.baseRadius;
    let entity;
    const x = rand(W * 0.12, W * 0.88);

    if (kind === 'fruit') {
      const key = pick(FRUIT_KEYS);
      r *= FRUIT_TYPES[key].radius;
      entity = new Fruit(key, x, H + r, 0, 0, r);
    } else if (kind === 'bomb') {
      r *= 0.95;
      entity = new Bomb(x, H + r, 0, 0, r);
    } else {
      const key = pick(Object.keys(POWERUPS).filter((k) => k !== 'life' || this.lives < this.maxLives + 1));
      r *= 0.9;
      entity = new PowerUp(key, x, H + r, 0, 0, r);
    }

    // vertical speed so the apex lands between 12% and 45% of screen height
    const apexY = rand(H * 0.12, H * 0.45);
    const gEff = g * entity.gravityScale;
    const vy = -Math.sqrt(2 * gEff * (entity.y - apexY));
    const flight = (2 * -vy) / gEff;
    // drift horizontally toward a point that keeps the item on screen
    const targetX = clamp(x + rand(-W * 0.25, W * 0.25), W * 0.1, W * 0.9);
    entity.vx = (targetX - x) / flight;
    entity.vy = vy;
    this.items.push(entity);
  }

  /* ---------------- slicing ---------------- */

  /** Test fresh trail segments against every live item. Each item can only be hit once per frame. */
  handleSlices(segments) {
    if (!segments.length) return;
    const minSpeed = this.inputMode === 'hand' ? 90 : 60;   // px/s — ignore a resting finger
    for (const item of this.items) {
      if (item.dead) continue;
      const hitR = item.r * (item.kind === 'bomb' ? 0.95 : 1.1);
      for (const s of segments) {
        if (s.speed < minSpeed) continue;
        if (segCircleHit(s.x1, s.y1, s.x2, s.y2, item.x, item.y, hitR)) {
          this.onHit(item, s);
          break;
        }
      }
    }
  }

  onHit(item, seg) {
    item.dead = true;
    const angle = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
    if (item.kind === 'fruit') this.sliceFruit(item, angle);
    else if (item.kind === 'bomb') this.hitBomb(item);
    else this.collectPowerUp(item);
  }

  sliceFruit(fruit, angle) {
    const { x, y, r, type } = fruit;
    this.halves.push(...fruit.split(angle));

    // visuals
    const ext = r * 1.4;
    this.particles.slash(x - Math.cos(angle) * ext, y - Math.sin(angle) * ext, x + Math.cos(angle) * ext, y + Math.sin(angle) * ext);
    this.particles.juice(x, y, type.color, angle, 16 + Math.floor(r / 4), r / 40);
    this.particles.splat(x, y, type.color, r * 0.9);

    // scoring
    const points = type.points * this.scoreMult;
    this.addScore(points);
    this.particles.text(x, y - r * 0.5, `+${points}`, { color: this.scoreMult > 1 ? '#ffcc33' : '#ffffff', size: clamp(this.unit * 0.04, 18, 34) });
    this.stats.recordSlice(fruit.key);
    this.audio.slice();

    // combo bookkeeping: consecutive slices within a short window count as one swipe
    this.comboCount++;
    this.comboTimer = 0.45;
    this.lastSlice = { x, y };
    if (this.comboCount >= 2) this.ui.showCombo(this.comboCount);
  }

  hitBomb(bomb) {
    this.particles.explosion(bomb.x, bomb.y, clamp(this.unit / 700, 0.7, 1.4));
    this.shake = clamp(this.unit * 0.035, 14, 32);
    this.ui.flash('#ff2d2d');
    this.audio.explosion();
    this.stats.recordBomb();
    this.comboCount = 0;
    this.comboTimer = 0;
    this.trail.break();
    this.particles.text(bomb.x, bomb.y - bomb.r, 'BOOM!', { color: '#ff6a00', size: clamp(this.unit * 0.07, 30, 60), life: 1.1 });
    this.loseLife();
  }

  collectPowerUp(p) {
    const def = p.type;
    this.particles.sparkle(p.x, p.y, def.color);
    this.audio.powerUp();
    this.stats.recordPowerUp();
    this.ui.flash(def.color);
    this.particles.text(p.x, p.y - p.r, def.label, { color: def.color, size: clamp(this.unit * 0.05, 22, 44), life: 1.2 });

    if (p.key === 'life') {
      this.lives = Math.min(this.lives + 1, this.maxLives + 2);
      this.ui.updateLives(this.lives, this.maxLives);
    } else {
      this.activePowerups[p.key] = def.duration;
      this.applyPowerupState();
    }
  }

  /** Derive timeScale / scoreMult from whatever power-ups are active. */
  applyPowerupState() {
    this.timeScale = this.activePowerups.slow > 0 ? 0.42 : 1;
    this.scoreMult = this.activePowerups.double > 0 ? 2 : 1;
  }

  addScore(points) {
    this.score += points;
    this.stats.setScore(this.score);
    if (this.score > this.highScore) {
      this.highScore = this.score;   // live-update the "BEST" readout; persisted at game over
    }
    this.ui.updateScore(this.score, this.highScore);
  }

  loseLife() {
    if (this.state !== 'playing') return;   // ignore misses that land after game over
    this.lives--;
    this.ui.updateLives(this.lives, this.maxLives);
    if (this.lives <= 0) this.gameOver();
  }

  /* ---------------- main loop ---------------- */

  frame() {
    const t = nowSec();
    let dt = Math.min(0.05, t - this.lastFrame);   // clamp to avoid physics explosions after a stall
    this.lastFrame = t;
    this.time += dt;

    if (this.state === 'playing') this.update(dt);
    this.render();
    requestAnimationFrame(() => this.frame());
  }

  update(dt) {
    const sdt = dt * this.timeScale;    // scaled time for everything affected by slow-mo
    this.elapsed += sdt;
    this.realElapsed += dt;
    this.stats.addTime(dt);

    // --- pointer smoothing & trail ---
    if (this.pointer.active) {
      const k = 1 - Math.exp(-dt * (this.inputMode === 'hand' ? 22 : 40));
      this.pointer.x = lerp(this.pointer.x, this.pointerTarget.x, k);
      this.pointer.y = lerp(this.pointer.y, this.pointerTarget.y, k);
      this.trail.addPoint(this.pointer.x, this.pointer.y, this.time);
    }
    this.trail.update(this.time);
    this.handleSlices(this.trail.consumeSegments());

    // --- spawning ---
    this.spawnTimer -= sdt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = this.currentSpawnInterval;
    }
    for (let i = this.launchQueue.length - 1; i >= 0; i--) {
      const q = this.launchQueue[i];
      q.at -= sdt;
      if (q.at <= 0) { this.launch(q.kind); this.launchQueue.splice(i, 1); }
    }

    // --- entities ---
    const g = this.gravity;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.dead) { this.items.splice(i, 1); continue; }
      it.update(sdt, g);
      if (it.isBelowScreen(this.H)) {
        this.items.splice(i, 1);
        if (it.kind === 'fruit') this.onFruitMissed(it);
      }
    }
    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.update(sdt, g);
      if (h.isBelowScreen(this.H) || h.age > 4) this.halves.splice(i, 1);
    }

    // --- combo resolution (real time, so slow-mo doesn't make combos easier) ---
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.resolveCombo();
    }

    // --- power-up timers ---
    let changed = false;
    const chips = [];
    for (const key of Object.keys(this.activePowerups)) {
      this.activePowerups[key] -= dt;
      if (this.activePowerups[key] <= 0) { delete this.activePowerups[key]; changed = true; }
      else chips.push({ label: POWERUPS[key].label, color: POWERUPS[key].color, remaining: this.activePowerups[key] });
    }
    if (changed) this.applyPowerupState();
    this.ui.updatePowerups(chips);

    // --- effects ---
    this.particles.update(sdt);
    if (this.shake > 0.5) {
      this.shakeX = rand(-this.shake, this.shake);
      this.shakeY = rand(-this.shake, this.shake);
      this.shake *= Math.exp(-dt * 9);
    } else { this.shake = 0; this.shakeX = 0; this.shakeY = 0; }

    // --- hand lost hint ---
    if (this.inputMode === 'hand') {
      this.handLostTime = this.handDetected ? 0 : this.handLostTime + dt;
    }

    // --- achievements (cheap check every ~0.5s) ---
    this._achCheck = (this._achCheck || 0) + dt;
    if (this._achCheck > 0.5) { this._achCheck = 0; this.unlockAchievements(); }
  }

  onFruitMissed() {
    this.stats.recordMiss();
    if (this.diff.missCostsLife) {
      this.audio.miss();
      this.ui.flash('#ff8a4d');
      this.loseLife();
    }
  }

  /** Called when the combo window closes: award a bonus for 3+ fruit in one swipe. */
  resolveCombo() {
    const n = this.comboCount;
    this.comboCount = 0;
    this.stats.recordCombo(n);
    if (n >= 3) {
      const bonus = n * 10 * this.scoreMult;
      this.addScore(bonus);
      this.audio.combo(n);
      this.particles.text(
        clamp(this.lastSlice.x, this.W * 0.2, this.W * 0.8), clamp(this.lastSlice.y - 40, 60, this.H - 60),
        `${n}× COMBO  +${bonus}`,
        { color: '#ffcc33', size: clamp(this.unit * 0.065, 28, 56), life: 1.3, vy: -40 },
      );
      this.ui.flash('rgba(255,204,51,0.6)');
    }
  }

  /* ---------------- rendering ---------------- */

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.shakeX, this.shakeY);

    // background (static) — slightly oversized to hide shake edges
    ctx.drawImage(this.bgCanvas, -40, -40, this.W + 80, this.H + 80);

    // faint mirrored camera preview so the player can see where their hand is
    if (this.showCamera && this.tracker.active && this.video.readyState >= 2) {
      const fit = this.cameraFit();
      ctx.save();
      ctx.globalAlpha = this.state === 'playing' || this.state === 'countdown' || this.state === 'paused' ? 0.28 : 0.15;
      ctx.translate(this.W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, this.W - fit.x - fit.w, fit.y, fit.w, fit.h);
      ctx.restore();
    }

    // slow-mo tint
    if (this.timeScale < 1 && this.state === 'playing') {
      ctx.fillStyle = 'rgba(77,208,255,0.12)';
      ctx.fillRect(-40, -40, this.W + 80, this.H + 80);
    }

    this.particles.drawBackground(ctx);

    // entities: halves first (behind), then whole items
    for (const h of this.halves) h.draw(ctx);
    for (const it of this.items) it.draw(ctx, this.time);

    this.particles.drawForeground(ctx);

    // blade
    this.trail.draw(ctx, this.time, clamp(this.unit * 0.012, 6, 12));

    // fingertip cursor in hand mode
    if (this.inputMode === 'hand' && this.handDetected && this.state !== 'menu') {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.pointer.x, this.pointer.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#4dd0ff';
      ctx.beginPath();
      ctx.arc(this.pointer.x, this.pointer.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // "hand lost" hint
    if (this.inputMode === 'hand' && this.state === 'playing' && this.handLostTime > 0.8) {
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 5);
      ctx.font = `${clamp(this.unit * 0.06, 22, 44)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('🖐 SHOW YOUR HAND', this.W / 2, this.H / 2);
      ctx.fillStyle = '#ffb84d';
      ctx.fillText('🖐 SHOW YOUR HAND', this.W / 2, this.H / 2);
      ctx.restore();
    }

    ctx.restore();
  }
}


/* =====================================================================
 * 10. BOOTSTRAP
 * ===================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  // Polyfill roundRect for older browsers (used by Bomb.draw)
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }
  window.game = new GameEngine();
});
