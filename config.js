// Sky Courier: Island Run — tuning constants for the flight model, world and HUD.
// Every number here is ours: the plane is a light single-prop courier, forgiving
// enough to learn in one sortie and strict enough that throttle and bank matter.
export const CONFIG = {
  worldSize: 6000, // terrain spans -3000..3000 on x and z, metres
  seaLevel: 0,
  gravitySink: 9.5, // m/s^2 of sink the wing must beat when slow
  minFlySpeed: 26, // m/s: below this the wing stops flying and the nose drops
  maxSpeed: 95, // m/s at full throttle in a dive
  cruiseSpeed: 62, // m/s at 70% throttle, level
  climbRate: 9, // m/s of climb at full power, level attitude
  rollRate: 1.9, // rad/s the bank chases the stick
  maxBank: 1.05, // rad of bank the stick can ask for (~60 deg)
  maxPitch: 0.55, // rad of pitch the stick can ask for (~31 deg)
  turnAuthority: 0.55, // how much bank turns the heading per second
  throttleRate: 0.8, // per second the throttle lever travels
  fuelCapacity: 100, // percent
  fuelBurn: 0.55, // percent per second at full throttle
  fuelBurnIdle: 0.06, // percent per second at idle
  damageHardLanding: 45, // damage of a landing flown too hard
  damageScrape: 30, // damage of clipping terrain or water
  ringRadius: 14, // metres: the glowing rings you fly through
  ringScore: 150, // points per ring
  landingScore: 500, // points for a clean landing after the rings
  perfectLandingBonus: 250, // extra for a gentle touchdown on the centreline
  cameraDistance: 30, // metres behind the plane in chase view
  cameraHeight: 7, // metres above the plane in chase view
  fov: 1.15, // radians, vertical field of view
  shotSeed: 20261127, // the seed every screenshot scene and the world share
};

export const RUNWAY = {
  x: 0, // centre of the strip
  z: 900, // centre of the strip
  length: 720, // along x
  width: 40, // along z
  height: 14, // flattened ground height under the strip, metres
  heading: -Math.PI / 2, // land heading west (-x), down the strip from the east end
};

// The three sorties on the title screen. Same plane, same island, different goals.
export const MODES = {
  islandRun: {
    id: 'islandRun',
    name: 'Island Run',
    tag: '6 rings, then land on the strip',
    rings: 6,
    fuel: 100,
    timed: false,
  },
  ringRush: {
    id: 'ringRush',
    name: 'Ring Rush',
    tag: '12 rings, 6:00 on the clock — rings refuel you',
    rings: 12,
    fuel: 100,
    timed: true,
    timeLimit: 360,
    fuelPerRing: 8, // a ring tops the tank up: keep hitting them to keep flying
  },
  freeFlight: {
    id: 'freeFlight',
    name: 'Free Flight',
    tag: 'No rings. Fly the island, land clean.',
    rings: 0,
    fuel: 100,
    timed: false,
  },
};
