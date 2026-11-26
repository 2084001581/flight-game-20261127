// Keyboard and mouse: the stick, the throttle lever and the buttons.
// Arrow keys / WASD pitch and bank, Shift / Ctrl work the throttle, the mouse
// steers by leaning toward the pointer, C swaps chase and cockpit, P pauses.
import { clamp } from './rng.js';

export function createInput() {
  return {
    keys: new Set(),
    mouseX: 0.5, // 0..1 across the screen; 0.5 is centred
    mouseY: 0.5, // 0..1 down the screen; 0.5 is centred
    mouseActive: false,
    mouseSeenAt: 0,
  };
}

const KEYMAP = {
  ArrowUp: 'pitchUp',
  KeyW: 'pitchUp',
  ArrowDown: 'pitchDown',
  KeyS: 'pitchDown',
  ArrowLeft: 'rollLeft',
  KeyA: 'rollLeft',
  ArrowRight: 'rollRight',
  KeyD: 'rollRight',
  ShiftLeft: 'throttleUp',
  ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown',
  ControlRight: 'throttleDown',
  KeyC: 'camera',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyR: 'restart',
  Enter: 'confirm',
  Space: 'confirm',
  Digit1: 'mode1',
  Digit2: 'mode2',
  Digit3: 'mode3',
};

// Keys the game answers the moment they go down, not while held.
export const EDGE_KEYS = new Set(['camera', 'pause', 'mute', 'restart', 'confirm', 'mode1', 'mode2', 'mode3']);

export function keyAction(code) {
  return KEYMAP[code] ?? null;
}

export function pressKey(input, action) {
  input.keys.add(action);
}

export function releaseKey(input, action) {
  input.keys.delete(action);
}

export function noteMouse(input, x, y, now) {
  input.mouseX = clamp(x, 0, 1);
  input.mouseY = clamp(y, 0, 1);
  input.mouseActive = true;
  input.mouseSeenAt = now;
}

// The stick this frame: -1..1 pitch (up is positive) and roll (right is
// positive), plus the throttle lever's travel. Keyboard and mouse blend: the
// mouse leans the stick toward the pointer, the keys add on top.
export function readStick(input, now) {
  let pitch = 0;
  let roll = 0;
  if (input.keys.has('pitchUp')) pitch += 1;
  if (input.keys.has('pitchDown')) pitch -= 1;
  if (input.keys.has('rollLeft')) roll -= 1;
  if (input.keys.has('rollRight')) roll += 1;
  if (input.mouseActive && now - input.mouseSeenAt < 4000) {
    roll += (input.mouseX - 0.5) * 1.6;
    pitch += (0.5 - input.mouseY) * 1.2;
  }
  let throttleDelta = 0;
  if (input.keys.has('throttleUp')) throttleDelta += 1;
  if (input.keys.has('throttleDown')) throttleDelta -= 1;
  return {
    pitch: clamp(pitch, -1, 1),
    roll: clamp(roll, -1, 1),
    throttleDelta,
  };
}

export function attachInput(input, onEdge, onClick) {
  const keydown = (event) => {
    const action = keyAction(event.code);
    if (!action) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    if (EDGE_KEYS.has(action)) {
      if (!event.repeat) onEdge(action);
      return;
    }
    pressKey(input, action);
  };
  const keyup = (event) => {
    const action = keyAction(event.code);
    if (action && !EDGE_KEYS.has(action)) releaseKey(input, action);
  };
  const mousemove = (event) => {
    noteMouse(input, event.clientX / window.innerWidth, event.clientY / window.innerHeight, performance.now());
  };
  const click = (event) => onClick(event.clientX, event.clientY);
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('mousemove', mousemove);
  window.addEventListener('click', click);
  return () => {
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('mousemove', mousemove);
    window.removeEventListener('click', click);
  };
}
