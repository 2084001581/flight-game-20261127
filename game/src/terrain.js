// The island: one hand-built archipelago, not a heightmap file. Three islands rise
// out of the sea, hills roll across the main one, and the runway strip is flattened
// into the meadow east of the village. Everything the physics and the renderer need
// comes from heightAt() and the seeded feature lists below.
import { CONFIG, RUNWAY } from './config.js';
import { makeRng, pickInRange } from './rng.js';

const rng = makeRng(CONFIG.shotSeed);

// Gaussian hill: {x, z, radius, height}. Summed, then sunk below sea level.
const HILLS = [
  { x: 0, z: 0, radius: 1500, height: 118 }, // the main island
  { x: -1850, z: -1450, radius: 720, height: 74 }, // north-west isle
  { x: 1950, z: 1650, radius: 640, height: 58 }, // south-east isle
  { x: -900, z: -700, radius: 520, height: 66 }, // Mount Kite
  { x: 1100, z: -900, radius: 430, height: 52 }, // the twin peaks
  { x: 1250, z: -1150, radius: 260, height: 44 },
  { x: -1500, z: 900, radius: 480, height: 48 }, // west ridge
  { x: 900, z: 1500, radius: 380, height: 38 }, // south meadow rise
  { x: -300, z: 1750, radius: 300, height: 30 },
  { x: 2100, z: -300, radius: 420, height: 40 }, // east headland
];

function bump(hill, x, z) {
  const dx = (x - hill.x) / hill.radius;
  const dz = (z - hill.z) / hill.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 > 9) return 0;
  return hill.height * Math.exp(-d2 * 1.6);
}

// Gentle rolling noise so the ground is never a perfect cone.
function rolling(x, z) {
  return (
    5.5 * Math.sin(x * 0.004 + 1.7) * Math.cos(z * 0.0035 - 0.6) +
    3.0 * Math.sin((x + z) * 0.009 + 4.0) +
    1.6 * Math.sin(x * 0.021 - z * 0.017)
  );
}

export function heightAt(x, z) {
  let height = -7; // the seabed
  for (let i = 0; i < HILLS.length; i += 1) height += bump(HILLS[i], x, z);
  if (height > 0) height += rolling(x, z) * Math.min(1, height / 25);
  // Flatten the runway strip, its apron and the approach meadow east of it
  // into one flat field, so the landing approach has clear air underneath.
  const corridorX0 = RUNWAY.x - RUNWAY.length / 2 - 90;
  const corridorX1 = RUNWAY.x + 900;
  const corridorZ0 = RUNWAY.z - RUNWAY.width / 2 - 90;
  const corridorZ1 = RUNWAY.z + RUNWAY.width / 2 + 90;
  if (x > corridorX0 - 90 && x < corridorX1 + 90 && z > corridorZ0 - 90 && z < corridorZ1 + 90) {
    const edgeX = Math.max(0, (corridorX0 - x) / 90, (x - corridorX1) / 90);
    const edgeZ = Math.max(0, (corridorZ0 - z) / 90, (z - corridorZ1) / 90);
    const edge = Math.max(edgeX, edgeZ);
    const blend = edge >= 1 ? 0 : 1 - edge * edge * (3 - 2 * edge);
    height = height * (1 - blend) + RUNWAY.height * blend;
  }
  return height;
}

export function isWater(x, z) {
  return heightAt(x, z) <= 0.5;
}

export function onRunway(x, z, margin = 0) {
  return (
    Math.abs(x - RUNWAY.x) <= RUNWAY.length / 2 + margin &&
    Math.abs(z - RUNWAY.z) <= RUNWAY.width / 2 + margin
  );
}

// Trees: seeded, on dry grass, clear of the strip and the village road.
export const TREES = (() => {
  const trees = [];
  const treeRng = makeRng(CONFIG.shotSeed + 7);
  let tries = 0;
  while (trees.length < 340 && tries < 6000) {
    tries += 1;
    const x = pickInRange(treeRng, -2900, 2900);
    const z = pickInRange(treeRng, -2900, 2900);
    const h = heightAt(x, z);
    if (h < 4 || h > 78) continue;
    if (onRunway(x, z, 70)) continue;
    if (Math.abs(x - 430) < 90 && Math.abs(z - 950) < 90) continue; // the tower yard
    trees.push({ x, z, h, size: pickInRange(treeRng, 7, 13), shade: treeRng() });
  }
  return trees;
})();

// Clouds: soft billboards drifting slowly above the island.
export const CLOUDS = (() => {
  const clouds = [];
  const cloudRng = makeRng(CONFIG.shotSeed + 21);
  for (let i = 0; i < 26; i += 1) {
    clouds.push({
      x: pickInRange(cloudRng, -2800, 2800),
      y: pickInRange(cloudRng, 260, 430),
      z: pickInRange(cloudRng, -2800, 2800),
      size: pickInRange(cloudRng, 90, 210),
      drift: pickInRange(cloudRng, 1.5, 4),
    });
  }
  return clouds;
})();

// The village: a dozen little houses with red roofs near the strip's west end.
export const HOUSES = (() => {
  const houses = [];
  const houseRng = makeRng(CONFIG.shotSeed + 33);
  for (let i = 0; i < 12; i += 1) {
    const x = -560 + (i % 4) * 55 + pickInRange(houseRng, -12, 12);
    const z = 1080 + Math.floor(i / 4) * 60 + pickInRange(houseRng, -10, 10);
    houses.push({ x, z, h: heightAt(x, z), w: 16, d: 13, tall: pickInRange(houseRng, 9, 14) });
  }
  return houses;
})();

// The control tower beside the apron, and the windsock at the strip's east end.
export const TOWER = { x: 430, z: 960, h: heightAt(430, 960), height: 42 };
export const WINDSOCK = { x: 330, z: 872, h: heightAt(330, 872) };

// The three islands, simplified, for the corner map.
export const ISLANDS = [
  { x: 0, z: 0, r: 1500 },
  { x: -1850, z: -1450, r: 720 },
  { x: 1950, z: 1650, r: 640 },
];
