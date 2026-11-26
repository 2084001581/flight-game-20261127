// The sorties' ring courses and the autopilot that flies them for the screenshots.
// Ring courses are hand-placed over the island's landmarks so every leg has
// something to look at: the headland, the twin peaks, Mount Kite, the west ridge.
import { CONFIG, MODES, RUNWAY } from './config.js';
import { heightAt } from './terrain.js';
import { bearingTo, headingError } from './flight.js';
import { clamp } from './rng.js';

function ringAt(x, z, aboveGround) {
  return { x, z, y: heightAt(x, z) + aboveGround, passed: false };
}

const ISLAND_RUN_COURSE = [
  ringAt(-700, 900, 105), // down the strip, past the west end over the village
  ringAt(-1400, 200, 130), // out to the west ridge
  ringAt(-1050, -650, 150), // round Mount Kite
  ringAt(150, -1250, 165), // over the north shore
  ringAt(1200, -750, 150), // between the twin peaks
  ringAt(1450, 250, 120), // home past the east headland
];

const RING_RUSH_COURSE = [
  ...ISLAND_RUN_COURSE.map((ring) => ({ ...ring })),
  ringAt(-1900, -1400, 130), // the north-west isle
  ringAt(-600, -1900, 140), // the far north shore
  ringAt(900, -1800, 150), // the north-east corner
  ringAt(2100, -300, 120), // the east headland, low
  ringAt(1950, 1650, 110), // the south-east isle
  ringAt(500, 1900, 120), // the south meadow
];

export function buildRings(modeId) {
  const course = modeId === 'ringRush' ? RING_RUSH_COURSE : ISLAND_RUN_COURSE;
  const count = MODES[modeId].rings;
  return course.slice(0, count).map((ring) => ({ ...ring, passed: false }));
}

// Where the next ring is, or the strip when the rings are done.
export function currentTarget(sortie) {
  const ring = sortie.rings[sortie.nextRing];
  if (ring) return { x: ring.x, y: ring.y, z: ring.z, kind: 'ring' };
  return { x: RUNWAY.x, y: RUNWAY.height + 40, z: RUNWAY.z, kind: 'strip' };
}

// A gentle pilot: point at the target, hold altitude, mind the throttle.
// The screenshot scenes fly the real rules with this stick, so every staged
// frame is a moment a player could really reach.
export function autopilotStick(sortie, wantLanding = false) {
  const plane = sortie.plane;
  const target = currentTarget(sortie);
  const error = headingError(plane, target.x, target.z);
  const roll = clamp(error * 1.4, -0.7, 0.7);
  let targetAltitude = target.y;
  let throttleDelta = 0;
  if (wantLanding && target.kind === 'strip') {
    // Land like a pilot: join a point east of the strip on its centreline,
    // then ride a shallow glide path down, keeping clear of the hills until
    // the strip is close. Never dive at the ground from far out.
    const distStrip = Math.hypot(plane.x - RUNWAY.x, plane.z - RUNWAY.z);
    // Join east of the strip, then track the centreline itself: aim at a point
    // 300 m ahead on the line, so a lateral offset always shows up as a
    // heading error to correct — aiming far down the line never converges.
    const approach = distStrip > 600
      ? { x: RUNWAY.x + 650, z: RUNWAY.z }
      : { x: plane.x - 300, z: RUNWAY.z };
    const approachError = headingError(plane, approach.x, approach.z);
    const terrainBelow = heightAt(plane.x, plane.z);
    // Glide path by along-track distance to the touchdown zone (the strip's
    // east third), not by distance to the strip's centre: past the centre the
    // path must keep going down, never rise again.
    const alongTrack = Math.max(0, plane.x - 100);
    const glideAltitude = RUNWAY.height - 2 + alongTrack * 0.06;
    // A safety floor over the hills, but never on short final: the approach
    // meadow east of the strip is flat, so the glide path is clear there.
    const floor = distStrip > 400 ? terrainBelow + 30 : 0;
    targetAltitude = Math.max(glideAltitude, floor);
    const pitch = clamp((targetAltitude - plane.y) * 0.008, -0.25, 0.25);
    // Hold approach speed: fast enough to fly until short final, then bleed
    // to touchdown speed. Never cut the power and stall on the way in.
    const wantSpeed = distStrip > 400 ? 55 : 40;
    const throttleDelta = plane.speed < wantSpeed - 3 ? 0.8 : plane.speed > wantSpeed + 3 ? -0.6 : 0;
    return { pitch, roll: clamp(approachError * 2.0, -0.6, 0.6), throttleDelta };
  }
  const altitudeError = targetAltitude - plane.y;
  const pitch = clamp(altitudeError * 0.006, -0.35, 0.35);
  if (plane.speed < 52) throttleDelta = 0.8;
  else if (plane.speed > 72) throttleDelta = -0.5;
  else throttleDelta = 0.15;
  return { pitch, roll, throttleDelta };
}

// Run the real rules forward for `seconds` with the autopilot, in fixed steps.
// Used by the screenshot scenes: the frame is a real flown moment, not a pose.
export function flyForward(sortie, seconds, stepFlightFn, checkRingsFn, wantLanding = false) {
  const STEP = 1 / 60;
  for (let t = 0; t < seconds; t += STEP) {
    if (sortie.phase !== 'flying') break;
    stepFlightFn(sortie, autopilotStick(sortie, wantLanding), STEP);
    if (sortie.phase === 'flying') checkRingsFn(sortie);
  }
}
