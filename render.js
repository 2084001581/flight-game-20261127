// The renderer: a hand-rolled pseudo-3D view. Sky, sun and sea, then the island
// as a projected heightfield mesh, trees, houses, the tower, the strip, the glowing
// rings, the plane (chase view) or the instrument panel (cockpit view), and the HUD.
// Everything is drawn with plain canvas 2D calls — no images, no libraries.
import { CONFIG, RUNWAY } from './config.js';
import { clamp, lerp, formatHeading, formatClock } from './rng.js';
import { heightAt, isWater, TREES, CLOUDS, HOUSES, TOWER, WINDSOCK, ISLANDS } from './terrain.js';

// Rows of the terrain mesh ahead of the camera: near rows dense, far rows sparse.
const ROW_DISTANCES = [6, 12, 20, 35, 55, 80, 115, 160, 220, 300, 400, 520, 670, 850, 1080, 1380];
const COLUMNS = 16;

const SKY_TOP = [38, 94, 168];
const SKY_HORIZON = [188, 216, 238];
const SEA_FAR = [64, 142, 178];
const SEA_NEAR = [34, 106, 148];
const HAZE = [190, 214, 232];

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function css(rgb, alpha = 1) {
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${alpha})`;
}

function hashNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// --- Camera -----------------------------------------------------------------

export function computeCamera(plane, view, lift = 0) {
  const heading = plane.heading;
  const pitch = plane.pitch;
  const roll = plane.roll;
  let pos;
  let lookPitch = pitch;
  let lookRoll = roll;
  if (view === 'cockpit') {
    pos = {
      x: plane.x + Math.sin(heading) * 2.5,
      y: plane.y + 1.2,
      z: plane.z + Math.cos(heading) * 2.5,
    };
  } else {
    // Chase: behind and above, smoothed by the caller through cameraState.
    const back = CONFIG.cameraDistance;
    const up = CONFIG.cameraHeight;
    pos = {
      x: plane.x - Math.sin(heading) * back * Math.cos(pitch),
      y: plane.y + up - Math.sin(pitch) * back * 0.4,
      z: plane.z - Math.cos(heading) * back * Math.cos(pitch),
    };
    lookPitch = pitch * 0.55 + lift;
    lookRoll = roll * 0.55;
  }
  const forward = {
    x: Math.sin(heading) * Math.cos(lookPitch),
    y: Math.sin(lookPitch),
    z: Math.cos(heading) * Math.cos(lookPitch),
  };
  let right = { x: -forward.z, y: 0, z: forward.x };
  const rightLen = Math.hypot(right.x, right.z) || 1;
  right = { x: right.x / rightLen, y: 0, z: right.z / rightLen };
  let upVec = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  // Roll the camera around the forward axis.
  const cosR = Math.cos(lookRoll);
  const sinR = Math.sin(lookRoll);
  const rolledRight = {
    x: right.x * cosR + upVec.x * sinR,
    y: right.y * cosR + upVec.y * sinR,
    z: right.z * cosR + upVec.z * sinR,
  };
  const rolledUp = {
    x: upVec.x * cosR - right.x * sinR,
    y: upVec.y * cosR - right.y * sinR,
    z: upVec.z * cosR - right.z * sinR,
  };
  return { pos, forward, right: rolledRight, up: rolledUp };
}

export function makeProjector(camera, width, height) {
  const focal = (height / 2) / Math.tan(CONFIG.fov / 2);
  const cx = width / 2;
  const cy = height / 2;
  return function project(x, y, z) {
    const dx = x - camera.pos.x;
    const dy = y - camera.pos.y;
    const dz = z - camera.pos.z;
    const cz = dx * camera.forward.x + dy * camera.forward.y + dz * camera.forward.z;
    if (cz < 0.6) return null;
    const px = dx * camera.right.x + dy * camera.right.y + dz * camera.right.z;
    const py = dx * camera.up.x + dy * camera.up.y + dz * camera.up.z;
    return { x: cx + (px / cz) * focal, y: cy - (py / cz) * focal, depth: cz, scale: focal / cz };
  };
}

// --- Terrain colours ----------------------------------------------------------

function groundColour(h, slope, x, z, depth) {
  let base;
  if (h <= 0.5) {
    const shimmer = hashNoise(x * 0.05, z * 0.05) * 10;
    base = mix(SEA_NEAR, SEA_FAR, clamp(depth / 900, 0, 1));
    base = [base[0] + shimmer, base[1] + shimmer, base[2] + shimmer * 0.5];
  } else if (h < 3) base = [224, 201, 143]; // sand
  else if (h < 55) base = [86, 148, 66]; // meadow
  else if (h < 85) base = [74, 122, 62]; // high grass
  else if (h < 115) base = [122, 112, 102]; // rock
  else base = [238, 242, 245]; // snow on the peaks
  const variation = 7 * Math.sin(x * 0.045) * Math.sin(z * 0.055) + 4 * Math.sin((x + z) * 0.11);
  const shade = clamp(1 - slope * 0.9, 0.55, 1.05);
  const fog = clamp(depth / 1500, 0, 0.75);
  const mixed = mix(
    [base[0] * shade + variation, base[1] * shade + variation, base[2] * shade + variation],
    HAZE,
    fog,
  );
  return css(mixed);
}

function drawTerrain(ctx, project, camera, width, height) {
  const fwd = camera.forward;
  const right = camera.right;
  // Grid points in camera space: rows ahead, columns across.
  const grid = [];
  for (let r = 0; r < ROW_DISTANCES.length; r += 1) {
    const d = ROW_DISTANCES[r];
    const half = d * 1.15 + 30;
    const row = [];
    for (let c = 0; c <= COLUMNS; c += 1) {
      const lateral = -half + (2 * half * c) / COLUMNS;
      const wx = camera.pos.x + fwd.x * d + right.x * lateral;
      const wz = camera.pos.z + fwd.z * d + right.z * lateral;
      const wy = heightAt(wx, wz);
      row.push({ x: wx, y: wy, z: wz, screen: project(wx, wy, wz) });
    }
    grid.push(row);
  }
  for (let r = grid.length - 1; r > 0; r -= 1) {
    const near = grid[r - 1];
    const far = grid[r];
    for (let c = 0; c < COLUMNS; c += 1) {
      const a = far[c];
      const b = far[c + 1];
      const cc = near[c + 1];
      const d = near[c];
      if (!a.screen || !b.screen || !cc.screen || !d.screen) continue;
      const midH = (a.y + b.y + cc.y + d.y) / 4;
      const slope = Math.abs(a.y - cc.y) / Math.max(1, ROW_DISTANCES[r] - ROW_DISTANCES[r - 1]);
      const midX = (a.x + b.x + cc.x + d.x) / 4;
      const midZ = (a.z + b.z + cc.z + d.z) / 4;
      const depth = Math.hypot(midX - camera.pos.x, midZ - camera.pos.z);
      ctx.fillStyle = groundColour(midH, slope, midX, midZ, depth);
      ctx.beginPath();
      ctx.moveTo(a.screen.x, a.screen.y);
      ctx.lineTo(b.screen.x, b.screen.y);
      ctx.lineTo(cc.screen.x, cc.screen.y);
      ctx.lineTo(d.screen.x, d.screen.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// --- Sky, sun, clouds ---------------------------------------------------------

function drawSky(ctx, camera, project, width, height) {
  const horizonPoint = project(
    camera.pos.x + camera.forward.x * 9000,
    camera.pos.y,
    camera.pos.z + camera.forward.z * 9000,
  );
  const horizonY = horizonPoint ? horizonPoint.y : height * 0.55;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, css(SKY_TOP));
  gradient.addColorStop(Math.max(0, Math.min(1, horizonY / height)), css(SKY_HORIZON));
  gradient.addColorStop(1, css(SEA_NEAR));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // The sun hangs north-east, high and warm.
  const sunDir = { x: 0.55, y: 0.62, z: -0.55 };
  const sun = project(
    camera.pos.x + sunDir.x * 8000,
    camera.pos.y + sunDir.y * 8000,
    camera.pos.z + sunDir.z * 8000,
  );
  if (sun) {
    const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 130);
    glow.addColorStop(0, 'rgba(255,244,200,0.95)');
    glow.addColorStop(0.25, 'rgba(255,226,150,0.55)');
    glow.addColorStop(1, 'rgba(255,226,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  return horizonY;
}

function drawClouds(ctx, project, camera) {
  const sorted = [...CLOUDS].sort((a, b) => {
    const da = (a.x - camera.pos.x) ** 2 + (a.z - camera.pos.z) ** 2;
    const db = (b.x - camera.pos.x) ** 2 + (b.z - camera.pos.z) ** 2;
    return db - da;
  });
  for (const cloud of sorted) {
    const p = project(cloud.x, cloud.y, cloud.z);
    if (!p || p.depth > 2600) continue;
    const size = cloud.size * p.scale * 0.9;
    if (size < 4) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    for (const [ox, oy, s] of [[-0.35, 0.08, 0.55], [0, 0, 0.75], [0.4, 0.06, 0.5], [0.1, -0.14, 0.45]]) {
      ctx.beginPath();
      ctx.ellipse(p.x + ox * size, p.y + oy * size, s * size, s * size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// --- Props: trees, houses, tower, strip --------------------------------------

function drawTrees(ctx, project, camera) {
  for (const tree of TREES) {
    const dx = tree.x - camera.pos.x;
    const dz = tree.z - camera.pos.z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 > 900 * 900) continue;
    const p = project(tree.x, tree.h, tree.z);
    if (!p) continue;
    const size = tree.size * p.scale;
    if (size < 1.5) continue;
    const shade = 60 + tree.shade * 40;
    ctx.fillStyle = `rgb(${34 + shade * 0.25 | 0},${96 + shade | 0},${44 + shade * 0.3 | 0})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - size * 1.6);
    ctx.lineTo(p.x - size * 0.7, p.y);
    ctx.lineTo(p.x + size * 0.7, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(p.x - size * 0.08, p.y, size * 0.16, size * 0.5);
  }
}

function drawBox(ctx, project, camera, x, baseY, z, w, d, h, topColour, sideColour) {
  const corners = [];
  for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
    corners.push(project(x + ox, baseY, z + oz));
    corners.push(project(x + ox, baseY + h, z + oz));
  }
  // corners: [b0,t0,b1,t1,b2,t2,b3,t3]; draw the top, then only the sides whose
  // outward normal faces the camera.
  if (corners.some((c) => c === null)) return;
  const top = [corners[1], corners[3], corners[5], corners[7]];
  ctx.fillStyle = topColour;
  ctx.beginPath();
  top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = sideColour;
  const faceDefs = [
    { face: [corners[0], corners[2], corners[3], corners[1]], normal: { x: 0, z: -1 } },
    { face: [corners[2], corners[4], corners[5], corners[3]], normal: { x: 1, z: 0 } },
    { face: [corners[4], corners[6], corners[7], corners[5]], normal: { x: 0, z: 1 } },
    { face: [corners[6], corners[0], corners[1], corners[7]], normal: { x: -1, z: 0 } },
  ];
  for (const { face, normal } of faceDefs) {
    const toCameraX = camera.pos.x - x;
    const toCameraZ = camera.pos.z - z;
    if (normal.x * toCameraX + normal.z * toCameraZ <= 0) continue;
    ctx.beginPath();
    face.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
}

function drawStrip(ctx, project) {
  const half = RUNWAY.length / 2;
  const w = RUNWAY.width / 2;
  // The strip in 60 m segments: a corner behind the camera must only hide its
  // own segment, never the whole strip.
  ctx.fillStyle = '#3c4148';
  for (let i = 0; i < 12; i += 1) {
    const x0 = RUNWAY.x - half + i * 60;
    const x1 = x0 + 60;
    const corners = [
      [x0, RUNWAY.z - w],
      [x1, RUNWAY.z - w],
      [x1, RUNWAY.z + w],
      [x0, RUNWAY.z + w],
    ].map(([x, z]) => project(x, RUNWAY.height + 0.4, z));
    if (corners.some((c) => c === null)) continue;
    ctx.beginPath();
    corners.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
  // Centreline dashes.
  ctx.fillStyle = '#f5f2e8';
  for (let i = -6; i <= 6; i += 1) {
    const x0 = RUNWAY.x + i * 52;
    const a = project(x0 - 18, RUNWAY.height + 0.6, RUNWAY.z - 1.2);
    const b = project(x0 + 18, RUNWAY.height + 0.6, RUNWAY.z - 1.2);
    const c = project(x0 + 18, RUNWAY.height + 0.6, RUNWAY.z + 1.2);
    const d = project(x0 - 18, RUNWAY.height + 0.6, RUNWAY.z + 1.2);
    if (!a || !b || !c || !d) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }
  // Threshold bars at both ends.
  ctx.fillStyle = '#f5f2e8';
  for (const endX of [RUNWAY.x - half + 18, RUNWAY.x + half - 18]) {
    for (const off of [-12, -4, 4, 12]) {
      const a = project(endX - 8, RUNWAY.height + 0.6, RUNWAY.z + off - 2);
      const b = project(endX + 8, RUNWAY.height + 0.6, RUNWAY.z + off - 2);
      const c = project(endX + 8, RUNWAY.height + 0.6, RUNWAY.z + off + 2);
      const d = project(endX - 8, RUNWAY.height + 0.6, RUNWAY.z + off + 2);
      if (!a || !b || !c || !d) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// --- Rings ---------------------------------------------------------------------

function ringNormal(rings, index) {
  const ring = rings[index];
  const next = rings[index + 1] ?? rings[index - 1] ?? { x: ring.x + 1, y: ring.y, z: ring.z };
  const prev = rings[index - 1] ?? { x: ring.x - 1, y: ring.y, z: ring.z };
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function drawRings(ctx, project, sortie, now) {
  const rings = sortie.rings;
  for (let i = 0; i < rings.length; i += 1) {
    const ring = rings[i];
    if (ring.passed) continue;
    const isNext = i === sortie.nextRing;
    const normal = ringNormal(rings, i);
    // Two perpendicular axes spanning the ring's disc.
    const up = Math.abs(normal.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axisA = {
      x: normal.y * up.z - normal.z * up.y,
      y: normal.z * up.x - normal.x * up.z,
      z: normal.x * up.y - normal.y * up.x,
    };
    const aLen = Math.hypot(axisA.x, axisA.y, axisA.z) || 1;
    axisA.x /= aLen;
    axisA.y /= aLen;
    axisA.z /= aLen;
    const axisB = {
      x: normal.y * axisA.z - normal.z * axisA.y,
      y: normal.z * axisA.x - normal.x * axisA.z,
      z: normal.x * axisA.y - normal.y * axisA.x,
    };
    const points = [];
    for (let k = 0; k < 28; k += 1) {
      const angle = (k / 28) * Math.PI * 2;
      const px = ring.x + (axisA.x * Math.cos(angle) + axisB.x * Math.sin(angle)) * CONFIG.ringRadius;
      const py = ring.y + (axisA.y * Math.cos(angle) + axisB.y * Math.sin(angle)) * CONFIG.ringRadius;
      const pz = ring.z + (axisA.z * Math.cos(angle) + axisB.z * Math.sin(angle)) * CONFIG.ringRadius;
      points.push(project(px, py, pz));
    }
    if (points.some((p) => p === null)) continue;
    const pulse = isNext ? 0.75 + 0.25 * Math.sin(now / 260) : 0.5;
    ctx.save();
    ctx.strokeStyle = isNext ? `rgba(255,196,0,${pulse})` : 'rgba(80,220,255,0.45)';
    ctx.lineWidth = Math.max(2, 900 / Math.max(1, points[0].depth) * 6);
    ctx.shadowColor = isNext ? '#ffb400' : '#37c8ff';
    ctx.shadowBlur = isNext ? 22 : 8;
    ctx.beginPath();
    points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    if (isNext) {
      const centre = project(ring.x, ring.y, ring.z);
      if (centre) {
        ctx.fillStyle = `rgba(255,196,0,${pulse})`;
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`RING ${i + 1}`, centre.x, centre.y - 26);
      }
    }
  }
}

// --- The plane (chase view) ------------------------------------------------------

export function drawPlane(ctx, project, plane, width, height) {
  const p = project(plane.x, plane.y, plane.z);
  if (!p) return;
  const span = Math.min(width, height) * 0.34;
  const len = span * 0.62;
  ctx.save();
  ctx.translate(p.x, p.y + span * 0.1);
  ctx.rotate(-plane.roll * 0.85);
  // Prop blur, ahead of the nose: a faint disc, not a pillar.
  ctx.fillStyle = 'rgba(220,225,230,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, -len * 0.62, span * 0.06, len * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Main wing.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-span / 2, len * 0.08);
  ctx.quadraticCurveTo(-span * 0.32, -len * 0.05, -span * 0.1, -len * 0.02);
  ctx.lineTo(span * 0.1, -len * 0.02);
  ctx.quadraticCurveTo(span * 0.32, -len * 0.05, span / 2, len * 0.08);
  ctx.quadraticCurveTo(span * 0.3, len * 0.16, 0, len * 0.14);
  ctx.quadraticCurveTo(-span * 0.3, len * 0.16, -span / 2, len * 0.08);
  ctx.fill();
  // Fuselage, nose up-screen.
  ctx.fillStyle = '#f7ead0';
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.62);
  ctx.quadraticCurveTo(span * 0.09, -len * 0.3, span * 0.075, len * 0.1);
  ctx.quadraticCurveTo(span * 0.06, len * 0.32, 0, len * 0.36);
  ctx.quadraticCurveTo(-span * 0.06, len * 0.32, -span * 0.075, len * 0.1);
  ctx.quadraticCurveTo(-span * 0.09, -len * 0.3, 0, -len * 0.62);
  ctx.fill();
  ctx.strokeStyle = '#c23b2e';
  ctx.lineWidth = Math.max(2, span * 0.02);
  ctx.beginPath();
  ctx.moveTo(-span * 0.07, -len * 0.28);
  ctx.lineTo(span * 0.07, -len * 0.28);
  ctx.stroke();
  // Tailplane and fin.
  ctx.fillStyle = '#c23b2e';
  ctx.beginPath();
  ctx.moveTo(-span * 0.2, len * 0.3);
  ctx.lineTo(span * 0.2, len * 0.3);
  ctx.lineTo(span * 0.12, len * 0.4);
  ctx.lineTo(-span * 0.12, len * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a93226';
  ctx.beginPath();
  ctx.moveTo(0, len * 0.28);
  ctx.lineTo(-span * 0.045, len * 0.44);
  ctx.lineTo(span * 0.045, len * 0.44);
  ctx.closePath();
  ctx.fill();
  // Canopy glint and registration.
  ctx.fillStyle = 'rgba(90,160,210,0.85)';
  ctx.beginPath();
  ctx.ellipse(0, -len * 0.3, span * 0.045, len * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3c4148';
  ctx.font = `bold ${Math.max(9, span * 0.045)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('SKY-27', 0, len * 0.05);
  // Navigation lights.
  ctx.fillStyle = '#ff3b30';
  ctx.beginPath();
  ctx.arc(-span / 2 + 3, len * 0.08, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#34c759';
  ctx.beginPath();
  ctx.arc(span / 2 - 3, len * 0.08, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- Cockpit panel ---------------------------------------------------------------

function drawGauge(ctx, x, y, radius, label, valueText) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(12,16,22,0.92)';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8b93a1';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e8ecf2';
  ctx.font = `bold ${Math.max(9, radius * 0.28)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, -radius * 0.45);
  ctx.font = `bold ${Math.max(11, radius * 0.36)}px system-ui, sans-serif`;
  ctx.fillText(valueText, 0, radius * 0.3);
  ctx.restore();
}

function drawArtificialHorizon(ctx, x, y, radius, plane) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.rotate(-plane.roll);
  const pitchShift = clamp(plane.pitch, -0.5, 0.5) * radius * 1.4;
  ctx.fillStyle = '#3f8fd2';
  ctx.fillRect(-radius, -radius - pitchShift, radius * 2, radius + pitchShift);
  ctx.fillStyle = '#8a6a42';
  ctx.fillRect(-radius, pitchShift, radius * 2, radius + pitchShift);
  ctx.strokeStyle = '#f5f2e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-radius, pitchShift);
  ctx.lineTo(radius, pitchShift);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#8b93a1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  // Fixed wings of the symbol.
  ctx.strokeStyle = '#ffc400';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.55, y);
  ctx.lineTo(x - radius * 0.15, y);
  ctx.moveTo(x + radius * 0.15, y);
  ctx.lineTo(x + radius * 0.55, y);
  ctx.stroke();
  ctx.fillStyle = '#e8ecf2';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', x, y + radius + 13);
}

export function drawCockpit(ctx, plane, width, height) {
  const panelTop = height - 168;
  // Canopy pillars.
  ctx.fillStyle = 'rgba(20,24,30,0.95)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width * 0.035, 0);
  ctx.lineTo(width * 0.075, panelTop);
  ctx.lineTo(0, panelTop);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.lineTo(width * 0.965, 0);
  ctx.lineTo(width * 0.925, panelTop);
  ctx.lineTo(width, panelTop);
  ctx.closePath();
  ctx.fill();
  // Nose cowling and the prop blur.
  ctx.fillStyle = '#b3352a';
  ctx.beginPath();
  ctx.moveTo(width / 2 - 150, height);
  ctx.quadraticCurveTo(width / 2 - 120, panelTop + 40, width / 2, panelTop + 26);
  ctx.quadraticCurveTo(width / 2 + 120, panelTop + 40, width / 2 + 150, height);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(220,225,230,0.18)';
  ctx.beginPath();
  ctx.ellipse(width / 2, panelTop + 8, 7, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  // Instrument panel.
  const panel = ctx.createLinearGradient(0, panelTop, 0, height);
  panel.addColorStop(0, '#232830');
  panel.addColorStop(1, '#12151a');
  ctx.fillStyle = panel;
  ctx.fillRect(0, panelTop, width, height - panelTop);
  ctx.strokeStyle = '#3a4150';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, panelTop);
  ctx.lineTo(width, panelTop);
  ctx.stroke();
  const cy = panelTop + 78;
  drawArtificialHorizon(ctx, width / 2, cy, 52, plane);
  drawGauge(ctx, width / 2 - 190, cy, 46, 'ALT m', String(Math.max(0, Math.round(plane.y))));
  drawGauge(ctx, width / 2 - 95, cy, 46, 'SPD km/h', String(Math.round(plane.speed * 3.6)));
  drawGauge(ctx, width / 2 + 95, cy, 46, 'HDG', formatHeading(plane.heading));
  drawGauge(ctx, width / 2 + 190, cy, 46, 'VSI m/s', (plane.verticalSpeed >= 0 ? '+' : '') + plane.verticalSpeed.toFixed(1));
  // Fuel and throttle bars at the panel's left end, clear of the corner map.
  const barX = 170;
  ctx.fillStyle = '#e8ecf2';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('FUEL', barX, panelTop + 30);
  ctx.fillStyle = '#20242c';
  ctx.fillRect(barX, panelTop + 38, 120, 12);
  ctx.fillStyle = plane.fuel < 20 ? '#ff453a' : '#34c759';
  ctx.fillRect(barX, panelTop + 38, 120 * (plane.fuel / 100), 12);
  ctx.fillStyle = '#e8ecf2';
  ctx.fillText('THR', barX, panelTop + 76);
  ctx.fillStyle = '#20242c';
  ctx.fillRect(barX, panelTop + 84, 120, 12);
  ctx.fillStyle = '#ffc400';
  ctx.fillRect(barX, panelTop + 84, 120 * plane.throttle, 12);
  // Stall lamp.
  if (plane.speed < 30 && !plane.onGround) {
    ctx.fillStyle = Math.floor(performance.now() / 300) % 2 === 0 ? '#ff453a' : '#7a1f1a';
    ctx.beginPath();
    ctx.arc(60, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STALL', 80, cy + 4);
  }
}

// --- HUD -------------------------------------------------------------------------

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,14,20,0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
}

export function drawHud(ctx, sortie, view, width, height, now) {
  const plane = sortie.plane;
  const mode = sortie.mode;
  ctx.textBaseline = 'alphabetic';
  // Top-left: the three numbers that matter.
  panel(ctx, 14, 12, 300, 66);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8fa3b8';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText('ALT', 26, 30);
  ctx.fillText('SPD', 116, 30);
  ctx.fillText('HDG', 206, 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`${Math.max(0, Math.round(plane.y))}m`, 26, 60);
  ctx.fillText(`${Math.round(plane.speed * 3.6)}`, 116, 60);
  ctx.fillText(formatHeading(plane.heading), 206, 60);
  ctx.fillStyle = '#8fa3b8';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText('km/h', 168, 60);
  // Top-centre: compass strip.
  const stripW = 340;
  const stripX = width / 2 - stripW / 2;
  panel(ctx, stripX, 12, stripW, 40);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(stripX, 12, stripW, 40, 8);
  ctx.clip();
  const headingDeg = ((plane.heading * 180) / Math.PI % 360 + 360) % 360;
  const pxPerDeg = stripW / 120;
  for (let d = Math.floor(headingDeg - 60); d <= headingDeg + 60; d += 5) {
    const deg = ((d % 360) + 360) % 360;
    const x = stripX + stripW / 2 + (d - headingDeg) * pxPerDeg;
    const major = deg % 30 === 0;
    ctx.strokeStyle = major ? '#ffffff' : '#8fa3b8';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, major ? 34 : 28);
    ctx.stroke();
    if (major && x > stripX + 20 && x < stripX + stripW - 20) {
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] ?? String(deg);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, 48);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#ffc400';
  ctx.beginPath();
  ctx.moveTo(width / 2 - 6, 12);
  ctx.lineTo(width / 2 + 6, 12);
  ctx.lineTo(width / 2, 22);
  ctx.closePath();
  ctx.fill();
  // Top-right: score, mode, fuel, time.
  panel(ctx, width - 254, 12, 240, 66);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fa3b8';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText(mode.name.toUpperCase(), width - 26, 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`SCORE ${plane.score}`, width - 26, 58);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8fa3b8';
  ctx.font = 'bold 11px system-ui, sans-serif';
  const timeText = mode.timed ? `TIME ${formatClock(sortie.timeLeft)}` : `TIME ${formatClock(sortie.elapsed)}`;
  ctx.fillText(timeText, width - 240, 30);
  ctx.fillStyle = plane.fuel < 20 ? '#ff453a' : '#34c759';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(`FUEL ${Math.round(plane.fuel)}%`, width - 240, 58);
  // Mission line under the top bar.
  const target = sortie.rings[sortie.nextRing];
  let missionText;
  if (sortie.rings.length === 0) missionText = 'FREE FLIGHT — LAND CLEAN ON THE STRIP WHEN READY';
  else if (target) {
    const dist = Math.round(Math.hypot(plane.x - target.x, plane.y - target.y, plane.z - target.z));
    missionText = `RING ${sortie.nextRing + 1} OF ${sortie.rings.length} — ${dist} m — FOLLOW THE GOLD RING`;
  } else missionText = 'ALL RINGS DONE — LAND ON THE STRIP, HEADING WEST';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,14,20,0.62)';
  const tw = ctx.measureText(missionText).width + 28;
  ctx.beginPath();
  ctx.roundRect(width / 2 - tw / 2, 60, tw, 26, 8);
  ctx.fill();
  ctx.fillStyle = '#ffd866';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillText(missionText, width / 2, 78);
  // Message banner: messageUntil is flight-seconds, like plane.time.
  if (plane.message && plane.time <= plane.messageUntil && sortie.phase === 'flying') {
    ctx.font = 'bold 17px system-ui, sans-serif';
    const mw = ctx.measureText(plane.message).width + 32;
    ctx.fillStyle = 'rgba(10,14,20,0.66)';
    ctx.beginPath();
    ctx.roundRect(width / 2 - mw / 2, height * 0.2, mw, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(plane.message, width / 2, height * 0.2 + 23);
  }
  // Throttle lever at the left edge.
  ctx.fillStyle = 'rgba(10,14,20,0.62)';
  ctx.beginPath();
  ctx.roundRect(14, height - 170, 26, 140, 8);
  ctx.fill();
  ctx.fillStyle = '#ffc400';
  ctx.fillRect(20, height - 40 - 120 * plane.throttle, 14, 120 * plane.throttle);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THR', 27, height - 176);
  // Corner map: the island from above.
  const mapR = 62;
  const mapX = width - mapR - 18;
  const mapY = height - mapR - 18;
  ctx.save();
  ctx.beginPath();
  ctx.arc(mapX, mapY, mapR, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1d5f86';
  ctx.fillRect(mapX - mapR, mapY - mapR, mapR * 2, mapR * 2);
  const scale = (mapR * 2) / 6200;
  for (const island of ISLANDS) {
    ctx.fillStyle = '#5da24a';
    ctx.beginPath();
    ctx.ellipse(mapX + island.x * scale, mapY + island.z * scale, island.r * scale, island.r * scale * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#f5f2e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mapX + (RUNWAY.x - RUNWAY.length / 2) * scale, mapY + RUNWAY.z * scale);
  ctx.lineTo(mapX + (RUNWAY.x + RUNWAY.length / 2) * scale, mapY + RUNWAY.z * scale);
  ctx.stroke();
  for (let i = 0; i < sortie.rings.length; i += 1) {
    const ring = sortie.rings[i];
    ctx.fillStyle = ring.passed ? '#34c759' : i === sortie.nextRing ? '#ffc400' : 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(mapX + ring.x * scale, mapY + ring.z * scale, i === sortie.nextRing ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.translate(mapX + plane.x * scale, mapY + plane.z * scale);
  ctx.rotate(plane.heading);
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.lineTo(-5, -5);
  ctx.lineTo(5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mapX, mapY, mapR, 0, Math.PI * 2);
  ctx.stroke();
  // View hint.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(view === 'cockpit' ? 'COCKPIT VIEW — C FOR CHASE' : 'CHASE VIEW — C FOR COCKPIT', 14, height - 14);
}

// --- Screens ---------------------------------------------------------------------

function centrePanel(ctx, width, height, boxW, boxH) {
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  ctx.beginPath();
  ctx.roundRect(width / 2 - boxW / 2, height / 2 - boxH / 2, boxW, boxH, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,196,0,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawTitle(ctx, width, height, best) {
  centrePanel(ctx, width, height, 620, 430);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc400';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText('SKY COURIER', width / 2, height / 2 - 158);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText('— Island Run —', width / 2, height / 2 - 124);
  ctx.fillStyle = '#c8d4e0';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('Fly the mail plane over the island. Thread the gold rings,', width / 2, height / 2 - 88);
  ctx.fillText('mind your fuel, and bring her home to the strip.', width / 2, height / 2 - 64);
  const modes = [
    ['1', 'ISLAND RUN', '6 rings, then land'],
    ['2', 'RING RUSH', '12 rings, 6:00 — rings refuel you'],
    ['3', 'FREE FLIGHT', 'No rings — just fly'],
  ];
  modes.forEach(([key, name, tag], i) => {
    const y = height / 2 - 30 + i * 44;
    ctx.fillStyle = 'rgba(255,196,0,0.14)';
    ctx.beginPath();
    ctx.roundRect(width / 2 - 250, y - 24, 500, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ffc400';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`[${key}]`, width / 2 - 238, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, width / 2 - 200, y);
    ctx.fillStyle = '#c8d4e0';
    ctx.textAlign = 'right';
    ctx.fillText(tag, width / 2 + 238, y);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c8d4e0';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText('↑ climb · ↓ dive · ← → bank · mouse steers too', width / 2, height / 2 + 112);
  ctx.fillText('SHIFT / CTRL throttle · C camera · P pause · M mute', width / 2, height / 2 + 134);
  ctx.fillText('Click a mode or press 1 / 2 / 3 to fly. Enter starts the highlighted sortie.', width / 2, height / 2 + 158);
  if (best > 0) {
    ctx.fillStyle = '#ffc400';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`BEST SCORE ${best}`, width / 2, height / 2 + 168);
  }
}

export function drawEnd(ctx, sortie, width, height) {
  const result = sortie.result;
  if (!result) return;
  centrePanel(ctx, width, height, 620, 340);
  ctx.textAlign = 'center';
  ctx.fillStyle = sortie.phase === 'landed' ? '#34c759' : '#ff453a';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(result.title, width / 2, height / 2 - 108);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(`SCORE ${result.score}`, width / 2, height / 2 - 56);
  ctx.fillStyle = '#c8d4e0';
  ctx.font = '15px system-ui, sans-serif';
  result.lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, height / 2 - 14 + i * 26);
  });
  ctx.fillStyle = '#ffc400';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText('Press R or click to fly again — 1 / 2 / 3 picks a new sortie', width / 2, height / 2 + 122);
}

export function drawPaused(ctx, width, height) {
  ctx.fillStyle = 'rgba(8,12,18,0.6)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('PAUSED', width / 2, height / 2 - 10);
  ctx.fillStyle = '#c8d4e0';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('P to resume — R to restart the sortie', width / 2, height / 2 + 26);
}

// --- Frame -------------------------------------------------------------------------

export function renderFrame(ctx, sortie, view, width, height, now) {
  const plane = sortie.plane;
  // On the title screen the camera looks a touch higher, so the plane sits
  // below the title card instead of behind it.
  const lift = sortie.phase === 'title' ? 0.17 : 0;
  const camera = computeCamera(plane, view, lift);
  const project = makeProjector(camera, width, height);
  drawSky(ctx, camera, project, width, height);
  drawTerrain(ctx, project, camera, width, height);
  drawClouds(ctx, project, camera);
  drawTrees(ctx, project, camera);
  drawStrip(ctx, project);
  // The tower, the windsock and the village, drawn after the ground.
  drawBox(ctx, project, camera, TOWER.x, TOWER.h, TOWER.z, 16, 16, TOWER.height, '#dfe6ec', '#9aa5b1');
  drawBox(ctx, project, camera, TOWER.x, TOWER.h + TOWER.height, TOWER.z, 22, 22, 8, '#c23b2e', '#8f2a1f');
  for (const house of HOUSES) {
    drawBox(ctx, project, camera, house.x, house.h, house.z, house.w, house.d, house.tall, '#b8452f', '#e8e2d4');
  }
  const sock = project(WINDSOCK.x, WINDSOCK.h + 12, WINDSOCK.z);
  if (sock) {
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sock.x, sock.y);
    ctx.lineTo(sock.x + 14, sock.y + 3);
    ctx.stroke();
  }
  drawRings(ctx, project, sortie, now);
  if (view === 'chase') drawPlane(ctx, project, plane, width, height);
  if (view === 'cockpit') drawCockpit(ctx, plane, width, height);
  drawHud(ctx, sortie, view, width, height, now);
  if (sortie.phase === 'title') drawTitle(ctx, width, height, sortie.best);
  if (sortie.phase === 'paused') drawPaused(ctx, width, height);
  if (sortie.phase === 'landed' || sortie.phase === 'crashed') drawEnd(ctx, sortie, width, height);
}
