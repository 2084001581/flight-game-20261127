// Sky Courier: Island Run — the game loop. Owns the canvas, the sortie, the
// camera choice and the screens; the rules live in flight.js, the world in
// terrain.js, the picture in render.js, the sound in audio.js.
import { CONFIG, MODES } from './config.js';
import { createSortie, createPlane, stepFlight, checkRings, PHASE, distanceToNextRing } from './flight.js';
import { buildRings } from './missions.js';
import { createInput, attachInput, readStick, keyAction } from './input.js';
import { renderFrame } from './render.js';
import { createAudio, startAudio, updateAudio, playRingChime, playThud, playCrash } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusLine = document.getElementById('status');

const input = createInput();
const audio = createAudio();
const viewState = { view: 'chase' };
let best = 0;
try {
  best = Number(window.localStorage.getItem('sky-courier-best') ?? 0) || 0;
} catch {
  best = 0; // private mode or a host that blocks storage: play without a best score
}
let sortie = newSortie('islandRun');
sortie.best = best;

function newSortie(modeId) {
  const mode = MODES[modeId];
  const fresh = createSortie(modeId, mode, buildRings(modeId));
  fresh.best = best;
  return fresh;
}

function startMode(modeId) {
  sortie = newSortie(modeId);
  sortie.phase = PHASE.FLYING;
  startAudio(audio);
  announce(`${sortie.mode.name}: throttle up with Shift, lift off past 30 m/s`);
}

function restartSortie() {
  const modeId = sortie.modeId;
  sortie = newSortie(modeId);
  sortie.phase = PHASE.FLYING;
  announce(`${sortie.mode.name} restarted`);
}

function announce(text) {
  statusLine.textContent = text;
}

function titleClickZones(width, height) {
  // The three mode rows drawn by drawTitle, in the same coordinates.
  return [
    { modeId: 'islandRun', y0: height / 2 - 54, y1: height / 2 - 20 },
    { modeId: 'ringRush', y0: height / 2 - 10, y1: height / 2 + 24 },
    { modeId: 'freeFlight', y0: height / 2 + 34, y1: height / 2 + 68 },
  ];
}

function handleClick(clientX, clientY) {
  startAudio(audio);
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (sortie.phase === PHASE.TITLE) {
    for (const zone of titleClickZones(viewSize.width, viewSize.height)) {
      if (y >= zone.y0 && y <= zone.y1 && x >= viewSize.width / 2 - 250 && x <= viewSize.width / 2 + 250) {
        startMode(zone.modeId);
        return;
      }
    }
    return;
  }
  if (sortie.phase === PHASE.LANDED || sortie.phase === PHASE.CRASHED) {
    restartSortie();
  }
}

function handleEdge(action) {
  if (action === 'camera') {
    viewState.view = viewState.view === 'chase' ? 'cockpit' : 'chase';
    return;
  }
  if (action === 'mute') {
    audio.muted = !audio.muted;
    return;
  }
  if (action === 'pause') {
    if (sortie.phase === PHASE.FLYING) sortie.phase = PHASE.PAUSED;
    else if (sortie.phase === PHASE.PAUSED) sortie.phase = PHASE.FLYING;
    return;
  }
  if (action === 'restart') {
    if (sortie.phase !== PHASE.TITLE) restartSortie();
    return;
  }
  if (action === 'confirm') {
    if (sortie.phase === PHASE.TITLE) startMode('islandRun');
    else if (sortie.phase === PHASE.LANDED || sortie.phase === PHASE.CRASHED) restartSortie();
    return;
  }
  if (action === 'mode1' || action === 'mode2' || action === 'mode3') {
    const modeId = action === 'mode1' ? 'islandRun' : action === 'mode2' ? 'ringRush' : 'freeFlight';
    startMode(modeId);
  }
}

attachInput(input, handleEdge, handleClick);

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.min(window.innerWidth, 1920);
  const height = Math.min(window.innerHeight, 1200);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

let viewSize = resizeCanvas();
window.addEventListener('resize', () => {
  viewSize = resizeCanvas();
});

// A test and debug handle: the state the screenshots and the play-tests read.
// (Also lets a player open the console and see the same numbers the HUD shows.)
window.SKYCOURIER = {
  get sortie() {
    return sortie;
  },
  get view() {
    return viewState.view;
  },
  startMode,
  restartSortie,
};

let lastTime = performance.now();
let shotStaged = false;

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  // Screenshot scenes: stage once, then hold the frame still.
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (shot && !shotStaged) {
    shotStaged = true;
    stageShot(shot, sortie, viewState);
    renderFrame(ctx, sortie, viewState.view, viewSize.width, viewSize.height, now);
    return; // no loop: the staged frame is the screenshot
  }
  if (sortie.phase === PHASE.FLYING) {
    const stick = readStick(input, now);
    const beforeRings = sortie.plane.ringsPassed;
    const beforePhase = sortie.phase;
    stepFlight(sortie, stick, dt);
    if (sortie.phase === PHASE.FLYING) {
      if (checkRings(sortie)) playRingChime(audio);
      if (sortie.mode.timed) {
        sortie.timeLeft = Math.max(0, sortie.mode.timeLimit - sortie.elapsed);
        if (sortie.timeLeft <= 0) {
          sortie.phase = PHASE.CRASHED;
          sortie.plane.crashReason = 'OUT OF TIME';
          sortie.result = {
            title: 'OUT OF TIME',
            lines: [`Rings flown: ${sortie.plane.ringsPassed} of ${sortie.rings.length}`, 'The clock beat the courier this time.'],
            score: sortie.plane.score,
          };
          playCrash(audio);
        }
      }
    }
    if (beforePhase === PHASE.FLYING && sortie.phase === PHASE.LANDED) {
      playThud(audio);
      if (sortie.plane.score > best) {
        best = sortie.plane.score;
        sortie.best = best;
        try {
          window.localStorage.setItem('sky-courier-best', String(best));
        } catch {
          // storage blocked: the best score just lives for this session
        }
      }
    }
    if (beforePhase === PHASE.FLYING && sortie.phase === PHASE.CRASHED) playCrash(audio);
    void beforeRings;
    updateAudio(audio, sortie.plane);
    if (sortie.phase === PHASE.FLYING) {
      const target = sortie.rings[sortie.nextRing];
      const hint = target
        ? `Next ring ${Math.round(distanceToNextRing(sortie))} m away`
        : 'Strip ahead — line up heading west';
      announce(
        `${sortie.mode.name} — altitude ${Math.round(sortie.plane.y)} m, ` +
          `speed ${Math.round(sortie.plane.speed * 3.6)} km/h. ${hint}.`,
      );
    }
  }
  renderFrame(ctx, sortie, viewState.view, viewSize.width, viewSize.height, now);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
