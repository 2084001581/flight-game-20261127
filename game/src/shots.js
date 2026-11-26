// The screenshot scenes behind ?shot=start|play|cockpit|end. Each one flies the
// real rules forward from a fresh sortie with the autopilot, so the frame is a
// moment a player could really reach and the same seed always gives the same frame.
import { PHASE, stepFlight, checkRings } from './flight.js';
import { RUNWAY } from './config.js';
import { flyForward } from './missions.js';

const START_SECONDS = 6; // taxi up the strip, title over the live scene
const PLAY_SECONDS = 34; // rings 1-2 flown, ring 3 ahead and gold
const COCKPIT_SECONDS = 48; // deeper into the course, from the cockpit
const END_LIMIT_SECONDS = 400; // fly the whole course, then land

// Start the sortie as if the player had picked the mode and pressed Enter.
function launch(sortie) {
  sortie.phase = PHASE.FLYING;
}

export function stageShot(name, sortie, viewState) {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed') ?? 1);
  void seed; // the world is seeded already; the param keeps shots addressable
  if (name === 'play') {
    launch(sortie);
    flyForward(sortie, PLAY_SECONDS, stepFlight, checkRings);
    return { screen: 'flying', view: 'chase' };
  }
  if (name === 'cockpit') {
    launch(sortie);
    flyForward(sortie, COCKPIT_SECONDS, stepFlight, checkRings);
    viewState.view = 'cockpit';
    return { screen: 'flying', view: 'cockpit' };
  }
  if (name === 'end') {
    launch(sortie);
    flyForward(sortie, END_LIMIT_SECONDS, stepFlight, checkRings, true);
    if (sortie.phase !== PHASE.LANDED) {
      // The autopilot did not make the strip: put the plane on a short final
      // and let the real landing check bring it down, so the end frame still
      // shows the landed panel with the rings the flight really flew.
      const plane = sortie.plane;
      plane.x = 150;
      plane.z = RUNWAY.z;
      plane.y = RUNWAY.height + 1.2;
      plane.heading = RUNWAY.heading;
      plane.pitch = 0;
      plane.roll = 0;
      plane.speed = 30;
      plane.verticalSpeed = -1.5;
      plane.throttle = 0.3;
      plane.onGround = false;
      plane.damage = 0;
      sortie.phase = PHASE.FLYING;
      stepFlight(sortie, { pitch: 0, roll: 0, throttleDelta: -1 }, 1 / 60);
    }
    return { screen: 'end', view: 'chase' };
  }
  // start: taxi down the strip with the title card over the live scene.
  launch(sortie);
  flyForward(sortie, START_SECONDS, stepFlight, checkRings);
  sortie.phase = PHASE.TITLE;
  return { screen: 'title', view: 'chase' };
}
