# 🍉 Fruit Slash — Gesture-Controlled Fruit Ninja

A complete Fruit Ninja style arcade game that runs **entirely in the browser**. Slice flying fruit with your
index finger via the webcam (MediaPipe Hands), or fall back to touch / mouse. No build step, no server,
no image or audio files — every asset is drawn with Canvas or synthesised with the Web Audio API.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page skeleton: canvas, hidden webcam `<video>`, HUD and all overlay screens |
| `style.css` | Arcade styling for HUD, menus, buttons, toasts and the countdown |
| `game.js` | All game logic, organised as classes (see architecture below) |

## Running locally

1. Put `index.html`, `style.css` and `game.js` in the same folder.
2. **Double-click `index.html`.** Chrome, Edge and Firefox all treat `file://` as a secure context, so the
   webcam prompt will appear when you click **Play with Webcam**.
3. Allow camera access, hold your hand up, and point with your index finger. Swipe fast through fruit.

An internet connection is needed the first time so the browser can fetch the MediaPipe Hands library
(~10 MB of WASM + model) from the jsDelivr CDN; it is cached afterwards. The arcade font also comes from
Google Fonts but the game falls back to Impact / system fonts if offline.

If your browser ever refuses camera access on `file://` (some locked-down corporate builds do), serve the
folder over localhost instead — any static server works, for example:

```bash
npx serve .
```

or

```bash
python -m http.server 8000
```

then open `http://localhost:8000`. The repo also ships an optional `.claude/launch.json` + `.claude/serve.ps1`
(a 30-line PowerShell static server) for people with no Node or Python installed.

### Controls

| Action | Webcam mode | Touch / mouse mode | Keyboard |
|---|---|---|---|
| Slice | Move index fingertip quickly | Drag across fruit | — |
| Pause / resume | ⏸ button | ⏸ button | `P` or `Esc` |
| Mute | 🔊 button | 🔊 button | `M` |
| Toggle camera preview | 📷 button | — | `C` |

## Gameplay summary

- **Fruit** 🍎 🍉 🍊 🍌 🍍 launch from the bottom with parabolic physics; each type has its own size,
  points and juice colour. Sliced fruit splits into two halves along the cut line, sprays juice particles and
  leaves a slowly fading splatter on the board.
- **Bombs** are drawn with canvas primitives (glossy body, fuse, flickering spark). Hitting one costs a life,
  shakes the screen, flashes red and triggers an explosion with fire, smoke and a shock ring.
- **Combos**: fruit sliced within 0.45 s of each other count as one swipe. 3+ fruit awards `n × 10` bonus
  points with an ascending arpeggio.
- **Difficulty ramps** over time: shorter spawn gaps, bigger waves, more bombs. Three presets (Easy / Normal /
  Hard) change lives, gravity, bomb odds and whether a missed fruit costs a life.
- **Power-ups** fly up occasionally: ⏳ Slow-Mo (time scale 0.42 for 6 s), ⭐ 2× Score (10 s), 💖 +1 Life.
- **Achievements** (14) unlock live with a toast; **statistics** (slices, accuracy, best combo, play time,
  bombs, power-ups, per-difficulty high scores) persist in `localStorage`.

## Architecture

Everything lives in `game.js`, split into self-contained classes. Data flows top-down from `GameEngine`;
no class reaches into another's internals.

```
┌─────────────────────────────── GameEngine ───────────────────────────────┐
│ state machine · spawning · physics · collision · scoring · render loop   │
│                                                                          │
│   HandTracker ──► onHand({x,y}) ──┐                                      │
│   pointer events ─────────────────┼──► pointer ──► SliceTrail            │
│                                   │               (segments)             │
│                                   ▼                   │                  │
│                          items: Fruit / Bomb / PowerUp ◄── segCircleHit  │
│                                   │                                      │
│                   ┌───────────────┼──────────────────┐                   │
│                   ▼               ▼                  ▼                   │
│            FruitHalf ×2    ParticleSystem       StatsManager             │
│                            juice·splat·boom     game + lifetime stats    │
│                            slash·text·ring      achievements             │
│                                                                          │
│            AudioManager (Web Audio SFX)      UIManager (DOM/HUD/screens) │
└──────────────────────────────────────────────────────────────────────────┘
```

| Class | Responsibility |
|---|---|
| **`AudioManager`** | Lazily creates an `AudioContext` on the first click (autoplay policy). Every effect — slice swish, combo arpeggio, explosion, miss thud, power-up sweep, countdown beep, game-over phrase, achievement chime — is built from oscillators and a shared white-noise buffer through a master gain used for muting. |
| **`HandTracker`** | Requests the webcam with `getUserMedia`, feeds frames to MediaPipe `Hands` in a `requestAnimationFrame` loop (skipping frames while the model is busy), and reports landmark #8 (index fingertip) as mirrored normalised coordinates with exponential smoothing. Translates every `getUserMedia` error into a readable message. |
| **`SliceTrail`** | Ring of recent pointer positions. Produces `{x1,y1,x2,y2,len,speed}` segments for collision tests (consumed once per frame) and draws a two-pass tapered glow blade. |
| **`Entity` → `Fruit`, `FruitHalf`, `Bomb`, `PowerUp`** | Shared projectile physics (gravity, drift, spin). `Fruit.split(angle)` returns two `FruitHalf` objects that render the same emoji clipped to one side of the cut (the clip rotates with the piece so the cut edge stays coherent) plus a flesh-coloured cut face. `Bomb.draw` is pure canvas; `PowerUp` adds a pulsing glow ring. |
| **`ParticleSystem`** | Pooled particles (circle / smoke / star), shock rings, slash flashes, floating texts, and a persistent offscreen *splat* canvas faded with `destination-out` in bursts so 8-bit alpha rounding still converges. |
| **`StatsManager`** | Per-game and lifetime counters, accuracy, achievement predicates, `localStorage` persistence via a try/catch wrapper that tolerates private-mode storage. |
| **`UIManager`** | The only class that touches the DOM. Exposes `updateScore`, `updateLives`, `showCombo`, `showScreen`, `toast`, etc., and turns button clicks into named events the engine subscribes to with `.on()`. |
| **`GameEngine`** | Owns the canvas (Hi-DPI aware), the state machine (`menu → countdown → playing ⇄ paused → gameover`), wave spawning with a difficulty curve, slow-motion time scaling, combo window, screen shake, and the `update()` / `render()` loop. |

### Performance notes

- Rendering uses a single 2D context with a pre-rendered background canvas; splatters live on their own
  offscreen canvas so they cost one `drawImage` per frame rather than hundreds of ellipses.
- Collision is segment-vs-circle on only the trail segments created this frame, against ≤ ~10 live items —
  trivially cheap. A minimum swipe speed filters out a resting fingertip.
- Particles are plain objects with swap-remove deletion and a hard cap (600).
- `dt` is clamped to 50 ms so a tab stall never launches fruit into orbit; the game also auto-pauses when the
  tab is hidden.
- MediaPipe runs at camera rate (~30 fps) while the game renders at display rate; the pointer is interpolated
  toward the latest fingertip each frame so the blade stays smooth.

### Browser support

Chrome, Edge and Firefox (current versions). Requires `getUserMedia`, Canvas 2D, Web Audio and WebAssembly.
On phones or laptops without a camera use **Play with Touch / Mouse**.
