// Sound, synthesised live with WebAudio — no audio files, no network.
// A prop hum that follows the throttle, wind that follows the speed, a chime
// for a ring and a thud for a touchdown.
export function createAudio() {
  return {
    context: null,
    engineOsc: null,
    engineOsc2: null,
    engineGain: null,
    windSource: null,
    windGain: null,
    windFilter: null,
    muted: false,
    started: false,
  };
}

export function startAudio(audio) {
  if (audio.started) return;
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    audio.context = context;
    audio.engineGain = context.createGain();
    audio.engineGain.gain.value = 0;
    audio.engineGain.connect(context.destination);
    audio.engineOsc = context.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineOsc.frequency.value = 55;
    audio.engineOsc2 = context.createOscillator();
    audio.engineOsc2.type = 'square';
    audio.engineOsc2.frequency.value = 110;
    const osc2Gain = context.createGain();
    osc2Gain.gain.value = 0.3;
    audio.engineOsc.connect(audio.engineGain);
    audio.engineOsc2.connect(osc2Gain);
    osc2Gain.connect(audio.engineGain);
    audio.engineOsc.start();
    audio.engineOsc2.start();
    // Wind: looped noise through a low-pass filter.
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    audio.windSource = context.createBufferSource();
    audio.windSource.buffer = buffer;
    audio.windSource.loop = true;
    audio.windFilter = context.createBiquadFilter();
    audio.windFilter.type = 'lowpass';
    audio.windFilter.frequency.value = 400;
    audio.windGain = context.createGain();
    audio.windGain.gain.value = 0;
    audio.windSource.connect(audio.windFilter);
    audio.windFilter.connect(audio.windGain);
    audio.windGain.connect(context.destination);
    audio.windSource.start();
    audio.started = true;
  } catch {
    audio.started = false; // silence is fine; the game plays without sound
  }
}

export function updateAudio(audio, plane) {
  if (!audio.started || !audio.context) return;
  if (audio.context.state === 'suspended') void audio.context.resume();
  const now = audio.context.currentTime;
  const throttle = plane.throttle;
  const targetEngine = audio.muted ? 0 : 0.045 + throttle * 0.05;
  audio.engineGain.gain.setTargetAtTime(targetEngine, now, 0.1);
  const rpm = 52 + throttle * 68 + plane.speed * 0.25;
  audio.engineOsc.frequency.setTargetAtTime(rpm, now, 0.1);
  audio.engineOsc2.frequency.setTargetAtTime(rpm * 2.02, now, 0.1);
  const wind = audio.muted ? 0 : Math.min(0.12, Math.max(0, (plane.speed - 25) * 0.0022));
  audio.windGain.gain.setTargetAtTime(wind, now, 0.15);
  audio.windFilter.frequency.setTargetAtTime(300 + plane.speed * 12, now, 0.2);
}

function blip(audio, frequency, when, duration, volume) {
  if (!audio.started || !audio.context || audio.muted) return;
  const context = audio.context;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, context.currentTime + when);
  gain.gain.linearRampToValueAtTime(volume, context.currentTime + when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + duration);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(context.currentTime + when);
  osc.stop(context.currentTime + when + duration + 0.05);
}

export function playRingChime(audio) {
  blip(audio, 659, 0, 0.18, 0.16);
  blip(audio, 880, 0.09, 0.22, 0.16);
  blip(audio, 1318, 0.18, 0.3, 0.12);
}

export function playThud(audio) {
  if (!audio.started || !audio.context || audio.muted) return;
  const context = audio.context;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, context.currentTime);
  osc.frequency.exponentialRampToValueAtTime(38, context.currentTime + 0.25);
  gain.gain.setValueAtTime(0.3, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.35);
}

export function playCrash(audio) {
  if (!audio.started || !audio.context || audio.muted) return;
  const context = audio.context;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, context.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, context.currentTime + 0.7);
  gain.gain.setValueAtTime(0.25, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.85);
}
