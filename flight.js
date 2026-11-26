// The flight model and the sortie state machine. One light prop plane, flown by
// throttle, pitch and bank: speed follows the throttle, bank turns the heading,
// pitch trades speed for altitude, and below flying speed the wing gives up.
import { CONFIG, RUNWAY } from './config.js';
import { clamp, angleDelta } from './rng.js';
import { heightAt, isWater, onRunway } from './terrain.js';

export const PHASE = {
  TITLE: 'title',
  FLYING: 'flying',
  PAUSED: 'paused',
  LANDED: 'landed',
  CRASHED: 'crashed',
};

export function createPlane(mode) {
  return {
    // Parked at the east end of the strip, nose west, ready to roll.
    x: RUNWAY.x + RUNWAY.length / 2 - 60,
    y: RUNWAY.height + 2,
    z: RUNWAY.z,
    heading: RUNWAY.heading,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: mode.fuel,
    damage: 0,
    verticalSpeed: 0,
    onGround: true,
    airborne: false,
    time: 0,
    ringsPassed: 0,
    score: 0,
    message: '',
    messageUntil: 0,
    crashReason: '',
    landingQuality: 0,
  };
}

export function createSortie(modeId, mode, rings) {
  return {
    modeId,
    mode,
    rings, // [{x, y, z, passed}] in flying order
    nextRing: 0,
    phase: PHASE.TITLE,
    plane: createPlane(mode),
    best: 0,
    elapsed: 0,
    timeLeft: mode.timed ? mode.timeLimit : 0,
    result: null, // filled on landing / crash: {title, lines[], score}
  };
}

// Steer the plane one step. `stick` is {pitch: -1..1, roll: -1..1, throttleDelta}
// from the keyboard and mouse; the autopilot passes the same shape.
export function stepFlight(sortie, stick, dt) {
  const plane = sortie.plane;
  const config = CONFIG;
  plane.time += dt;
  sortie.elapsed += dt;

  // Throttle lever.
  plane.throttle = clamp(plane.throttle + stick.throttleDelta * config.throttleRate * dt, 0, 1);
  const engineOut = plane.fuel <= 0;
  const power = engineOut ? 0 : plane.throttle;

  // Fuel burns with the throttle; an empty tank means gliding, not falling.
  const burn = config.fuelBurnIdle + (config.fuelBurn - config.fuelBurnIdle) * power;
  plane.fuel = Math.max(0, plane.fuel - burn * dt);
  if (engineOut && plane.messageUntil < plane.time) {
    plane.message = 'FUEL EMPTY — GLIDING, FIND THE STRIP';
    plane.messageUntil = plane.time + 3;
  }

  // Bank and pitch chase the stick, faster when there is airflow. ArrowUp / W climbs.
  const authority = clamp(plane.speed / 40, 0.25, 1);
  const targetRoll = stick.roll * config.maxBank;
  const targetPitch = stick.pitch * config.maxPitch; // positive pitch is nose-up
  plane.roll += clamp(targetRoll - plane.roll, -config.rollRate * authority * dt, config.rollRate * authority * dt);
  plane.pitch += clamp(targetPitch - plane.pitch, -config.rollRate * 0.7 * authority * dt, config.rollRate * 0.7 * authority * dt);

  // Speed: throttle pulls it up, drag and climbing pull it down, diving adds it back.
  const targetSpeed = 12 + power * 78;
  const climbPenalty = Math.max(0, Math.sin(plane.pitch)) * 26;
  const diveBonus = Math.max(0, -Math.sin(plane.pitch)) * 18;
  const speedTarget = clamp(targetSpeed - climbPenalty + diveBonus, 0, config.maxSpeed);
  const accel = plane.onGround ? 14 : 9;
  plane.speed += clamp(speedTarget - plane.speed, -accel * dt, accel * dt);

  // Stall: below flying speed the nose drops and the plane sinks.
  const stalled = plane.speed < config.minFlySpeed && !plane.onGround;
  if (stalled) {
    plane.pitch = Math.max(plane.pitch - 0.5 * dt, -0.3);
    plane.verticalSpeed -= config.gravitySink * 0.6 * dt;
  }

  // Bank turns the heading; the turn bites harder with speed.
  const turnRate = config.turnAuthority * Math.sin(plane.roll) * clamp(plane.speed / 50, 0.3, 1.2);
  plane.heading += turnRate * dt;

  // Move.
  const forward = Math.cos(plane.pitch);
  plane.x += Math.sin(plane.heading) * plane.speed * forward * dt;
  plane.z += Math.cos(plane.heading) * plane.speed * forward * dt;
  const climbSpeed = plane.speed * Math.sin(plane.pitch);
  plane.verticalSpeed = plane.onGround ? 0 : climbSpeed + (stalled ? plane.verticalSpeed * 0.4 : 0);
  plane.y += plane.verticalSpeed * dt;

  // Stay inside the charted sea.
  const bound = 2950;
  if (Math.abs(plane.x) > bound || Math.abs(plane.z) > bound) {
    plane.heading += Math.PI;
    plane.x = clamp(plane.x, -bound, bound);
    plane.z = clamp(plane.z, -bound, bound);
    plane.message = 'EDGE OF THE CHART — TURNING BACK';
    plane.messageUntil = plane.time + 2;
  }

  // Ground, water and the strip.
  const ground = heightAt(plane.x, plane.z);
  const clearance = plane.y - ground;
  const overStrip = onRunway(plane.x, plane.z);
  const gentle = Math.abs(plane.verticalSpeed) < 4 && Math.abs(plane.roll) < 0.25;
  if (clearance <= 1.5) {
    if (overStrip && plane.speed < 48 && gentle && plane.speed > 8) {
      landPlane(sortie, plane.verticalSpeed);
      return;
    }
    if (plane.onGround && plane.speed < 12 && clearance <= 1.5) {
      // Rolling along the strip or the meadow: stay planted, bleed speed.
      plane.y = ground + 1.5;
      plane.speed = Math.max(0, plane.speed - 6 * dt);
      plane.pitch = 0;
      plane.roll *= 0.9;
      return;
    }
    crashPlane(sortie, isWater(plane.x, plane.z) ? 'DITCHED IN THE SEA' : 'FLOWN INTO THE GROUND');
    return;
  }
  if (plane.onGround && plane.speed > config.minFlySpeed + 4 && plane.pitch > 0.03) {
    plane.onGround = false;
    plane.airborne = true;
    plane.message = 'AIRBORNE — GEAR UP, FLY THE RINGS';
    plane.messageUntil = plane.time + 2.5;
  }
  if (!plane.onGround && plane.y < ground + 1.5) plane.y = ground + 1.5;
}

// A ring counts when the plane flies through its disc.
export function checkRings(sortie) {
  const plane = sortie.plane;
  const ring = sortie.rings[sortie.nextRing];
  if (!ring || ring.passed) return false;
  const dx = plane.x - ring.x;
  const dy = plane.y - ring.y;
  const dz = plane.z - ring.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < CONFIG.ringRadius + 2) {
    ring.passed = true;
    sortie.nextRing += 1;
    plane.ringsPassed += 1;
    plane.score += CONFIG.ringScore;
    if (sortie.mode.fuelPerRing) {
      plane.fuel = Math.min(100, plane.fuel + sortie.mode.fuelPerRing);
    }
    if (sortie.nextRing >= sortie.rings.length) {
      plane.message = 'ALL RINGS — BRING HER HOME TO THE STRIP';
      plane.messageUntil = plane.time + 4;
    } else {
      plane.message = `RING ${plane.ringsPassed} OF ${sortie.rings.length} — NICE FLYING`;
      plane.messageUntil = plane.time + 2;
    }
    return true;
  }
  return false;
}

export function distanceToNextRing(sortie) {
  const ring = sortie.rings[sortie.nextRing];
  if (!ring) return 0;
  const plane = sortie.plane;
  return Math.sqrt(
    (plane.x - ring.x) ** 2 + (plane.y - ring.y) ** 2 + (plane.z - ring.z) ** 2,
  );
}

export function distanceToStrip(plane) {
  return Math.sqrt(
    (plane.x - RUNWAY.x) ** 2 + (plane.z - RUNWAY.z) ** 2,
  );
}

// Heading the pilot should fly to reach a point, for the compass needle.
export function bearingTo(plane, x, z) {
  return Math.atan2(x - plane.x, z - plane.z);
}

export function headingError(plane, x, z) {
  return angleDelta(plane.heading, bearingTo(plane, x, z));
}

function landPlane(sortie, descentRate) {
  const plane = sortie.plane;
  plane.onGround = true;
  const centreError = Math.abs(plane.z - RUNWAY.z);
  const gentleTouch = Math.abs(descentRate) < 2.5;
  plane.verticalSpeed = 0;
  plane.y = heightAt(plane.x, plane.z) + 1.5;
  plane.pitch = 0;
  plane.roll = 0;
  plane.landingQuality = clamp(1 - centreError / (RUNWAY.width / 2), 0, 1);
  const ringsDone = sortie.rings.length === 0 || sortie.nextRing >= sortie.rings.length;
  let points = CONFIG.landingScore;
  if (ringsDone && plane.landingQuality > 0.7 && gentleTouch) points += CONFIG.perfectLandingBonus;
  if (!ringsDone) points = Math.round(points * 0.4); // landed early: still counts, less
  plane.score += points;
  sortie.phase = PHASE.LANDED;
  sortie.result = {
    title: ringsDone ? 'MISSION COMPLETE — WELCOME HOME' : 'LANDED — BUT THE RINGS ARE STILL OUT THERE',
    lines: [
      `Rings flown: ${plane.ringsPassed} of ${sortie.rings.length}`,
      `Centreline: ${Math.round(plane.landingQuality * 100)}% — touchdown at ${Math.round(plane.speed * 3.6)} km/h`,
      `Fuel left: ${Math.round(plane.fuel)}% — damage: ${Math.round(plane.damage)}%`,
      `Flight time: ${plane.time.toFixed(1)} s`,
    ],
    score: plane.score,
  };
}

function crashPlane(sortie, reason) {
  const plane = sortie.plane;
  plane.damage = 100;
  plane.crashReason = reason;
  plane.speed = 0;
  sortie.phase = PHASE.CRASHED;
  sortie.result = {
    title: reason,
    lines: [
      `Rings flown: ${plane.ringsPassed} of ${sortie.rings.length}`,
      `Altitude at impact: ${Math.max(0, Math.round(plane.y))} m — speed ${Math.round(plane.speed * 3.6)} km/h`,
      'The courier is a write-off, but the pilot walked away. Fly again.',
    ],
    score: plane.score,
  };
}
