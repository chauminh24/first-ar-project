import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * A blob that behaves like liquid clay.
 *
 * Two layers of positions:
 *
 *  - `memory`: the clay shape. Pinching moves it, and it STAYS where you leave
 *    it. Only a very gentle surface tension and volume conservation touch it.
 *  - `pos`: what is drawn. It chases `memory` with a springy, damped motion,
 *    so the surface lags behind your fingers and jiggles when you let go.
 *
 * All units are local space, in a sphere of radius BLOB_RADIUS.
 */

export const BLOB_RADIUS = 0.62;

/* ------------------------------- tuning ----------------------------------- */

/** Icosphere subdivision. 28 gives about 8.4k vertices. */
const DETAIL = 28;
/** Size of one pinch, in local units (Gaussian sigma). */
export const GRAB_SIGMA = 0.27;
/** Pinch influence is cut off at sigma * this. */
const GRAB_CUTOFF = 2.4;
/** Farthest a vertex may get from its starting position. */
const MAX_DISPLACEMENT = 1.4;
/**
 * A vertex can not be pushed past this distance beyond the center along its own
 * original direction. Stops dents from punching through the far wall.
 */
const CORE_RADIUS = 0.16;
/**
 * When clay is dragged sideways along the surface, the neck between the tip and
 * the body bulges by this fraction of the drag. Together with BODY_FOLLOW this
 * stops sideways pulls from turning into thin flat skin.
 */
const NECK_BULGE = 0.25;
/**
 * Sideways drags also pull the whole body along a bit (this fraction of the
 * drag, spread over a wide area), like a solid lump of clay being stretched.
 */
const BODY_FOLLOW = 0.35;
const BODY_SIGMA = 0.7;
/**
 * Two-handed stretch: how much of the change in hand distance turns into a
 * volume-preserving stretch of the whole body (the rest is the local pull).
 */
const STRETCH_BLEND = 0.6;
/**
 * After release the body eases back to where the blob was born, so it stays
 * anchored. Per frame at 60fps.
 */
const RECENTER = 0.012;
/** Surface tension: smooths tiny spikes, keeps big shapes. Per frame at 60fps. */
const SMOOTHING = 0.014;
/** How fast total volume is pulled back to the starting volume. */
const VOLUME_BLEND = 0.04;
/** Jelly spring: render layer chases the clay layer. */
const SPRING = 0.07;
const DAMPING = 0.86;
/** While pinched, the surface follows your fingers tightly. */
const SPRING_GRAB = 0.4;
const DAMPING_GRAB = 0.7;
/** Idle liquid ripple, in local units. */
const WOBBLE = 0.02;

/* -------------------------------------------------------------------------- */

type Grab = {
  center: number;
  /** Tight pinch falloff, frozen when the pinch starts. One value per vertex. */
  local: Float32Array;
  /** Wide falloff for the body following a sideways drag. */
  wide: Float32Array;
};

export type PickResult = {
  index: number;
  /** Distance from the ray to the picked vertex. Small = a direct hit. */
  rayDistance: number;
};

export class ClayBlob {
  readonly geometry: THREE.BufferGeometry;
  readonly vertexCount: number;

  private readonly triangles: ArrayLike<number>;
  private readonly rest: Float32Array;
  private readonly memory: Float32Array;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly scratch: Float32Array;
  private readonly influence: Float32Array;
  private readonly grabWeight: Float32Array;
  private readonly neighborStart: Uint32Array;
  private readonly neighborList: Uint32Array;
  private readonly restVolume: number;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly normalAttr: THREE.BufferAttribute;
  private readonly grabs = new Map<number, Grab>();
  private readonly centroid = new THREE.Vector3();

  constructor() {
    let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(
      BLOB_RADIUS,
      DETAIL
    );
    // Icosahedron comes unindexed. Merge it so neighbouring triangles share
    // vertices: that gives a watertight surface with no seams to smooth over.
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    geometry = mergeVertices(geometry, 1e-4);
    geometry.computeVertexNormals();

    this.geometry = geometry;
    this.positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    this.normalAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);

    this.triangles = geometry.getIndex()!.array;
    this.vertexCount = this.positionAttr.count;

    const n = this.vertexCount;
    this.rest = Float32Array.from(this.positionAttr.array);
    this.memory = Float32Array.from(this.rest);
    this.pos = Float32Array.from(this.rest);
    this.vel = new Float32Array(n * 3);
    this.scratch = new Float32Array(n * 3);
    this.influence = new Float32Array(n);
    this.grabWeight = new Float32Array(n);

    // Neighbour lists (CSR) for surface smoothing.
    const neighbors: number[][] = Array.from({ length: n }, () => []);
    const link = (a: number, b: number) => {
      if (!neighbors[a].includes(b)) neighbors[a].push(b);
      if (!neighbors[b].includes(a)) neighbors[b].push(a);
    };
    for (let t = 0; t < this.triangles.length; t += 3) {
      const a = this.triangles[t];
      const b = this.triangles[t + 1];
      const c = this.triangles[t + 2];
      link(a, b);
      link(b, c);
      link(c, a);
    }
    this.neighborStart = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.neighborStart[i + 1] = this.neighborStart[i] + neighbors[i].length;
    }
    this.neighborList = new Uint32Array(this.neighborStart[n]);
    for (let i = 0; i < n; i++) {
      this.neighborList.set(neighbors[i], this.neighborStart[i]);
    }

    this.restVolume = this.measureVolume(this.memory);
  }

  /* ------------------------------ picking --------------------------------- */

  /**
   * Find the vertex a ray (in local space) is aimed at. Prefers the front-most
   * vertex the ray passes through. If the ray misses, returns the closest
   * vertex and how far the ray passed from it.
   */
  pick(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    tolerance = 0.07
  ): PickResult | null {
    const p = this.pos;
    const tol2 = tolerance * tolerance;

    let frontIndex = -1;
    let frontT = Infinity;
    let frontD2 = 0;
    let nearIndex = -1;
    let nearD2 = Infinity;

    for (let i = 0; i < this.vertexCount; i++) {
      const ox = p[i * 3] - origin.x;
      const oy = p[i * 3 + 1] - origin.y;
      const oz = p[i * 3 + 2] - origin.z;
      const t = ox * direction.x + oy * direction.y + oz * direction.z;
      if (t <= 0) continue;

      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      if (d2 < tol2 && t < frontT) {
        frontT = t;
        frontIndex = i;
        frontD2 = d2;
      }
      if (d2 < nearD2) {
        nearD2 = d2;
        nearIndex = i;
      }
    }

    if (frontIndex >= 0) {
      return { index: frontIndex, rayDistance: Math.sqrt(frontD2) };
    }
    if (nearIndex >= 0) {
      return { index: nearIndex, rayDistance: Math.sqrt(Math.max(0, nearD2)) };
    }
    return null;
  }

  /** Position of a vertex as drawn (local space). */
  getRenderPosition(index: number, out: THREE.Vector3) {
    return out.set(
      this.pos[index * 3],
      this.pos[index * 3 + 1],
      this.pos[index * 3 + 2]
    );
  }

  /* ------------------------------- grabbing -------------------------------- */

  beginGrab(id: number, vertexIndex: number, sigma = GRAB_SIGMA) {
    this.endGrab(id);

    const m = this.memory;
    const cx = m[vertexIndex * 3];
    const cy = m[vertexIndex * 3 + 1];
    const cz = m[vertexIndex * 3 + 2];
    const radius2 = (sigma * GRAB_CUTOFF) ** 2;
    const edge = Math.exp(-(GRAB_CUTOFF * GRAB_CUTOFF) / 2);

    const local = new Float32Array(this.vertexCount);
    const wide = new Float32Array(this.vertexCount);

    for (let i = 0; i < this.vertexCount; i++) {
      const dx = m[i * 3] - cx;
      const dy = m[i * 3 + 1] - cy;
      const dz = m[i * 3 + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;

      wide[i] = Math.exp(-d2 / (2 * BODY_SIGMA * BODY_SIGMA));
      if (d2 < radius2) {
        // Gaussian falloff, shifted so it reaches exactly 0 at the edge.
        local[i] = (Math.exp(-d2 / (2 * sigma * sigma)) - edge) / (1 - edge);
      }
    }

    this.grabs.set(id, { center: vertexIndex, local, wide });
  }

  /** Move the pinched clay by a local-space delta. The change stays. */
  moveGrab(id: number, dx: number, dy: number, dz: number) {
    const grab = this.grabs.get(id);
    if (!grab) return;

    const m = this.memory;
    const r = this.rest;

    // Outward direction at the pinch, split the move into along / sideways.
    const cx = m[grab.center * 3];
    const cy = m[grab.center * 3 + 1];
    const cz = m[grab.center * 3 + 2];
    const cl = Math.hypot(cx, cy, cz) || 1;
    const nx = cx / cl;
    const ny = cy / cl;
    const nz = cz / cl;
    const along = dx * nx + dy * ny + dz * nz;
    const tx = dx - along * nx;
    const ty = dy - along * ny;
    const tz = dz - along * nz;
    const sideways = Math.hypot(tx, ty, tz);

    for (let i = 0; i < this.vertexCount; i++) {
      const w = grab.local[i];
      const follow = grab.wide[i] * BODY_FOLLOW;
      if (w === 0 && follow < 0.003) continue;

      let x = m[i * 3] + dx * w + tx * follow;
      let y = m[i * 3 + 1] + dy * w + ty * follow;
      let z = m[i * 3 + 2] + dz * w + tz * follow;

      // Neck bulge: strongest halfway between the tip and the body.
      const bulge = NECK_BULGE * sideways * 4 * w * (1 - w);
      if (bulge > 0) {
        const l = Math.hypot(x, y, z) || 1;
        x += (x / l) * bulge;
        y += (y / l) * bulge;
        z += (z / l) * bulge;
      }

      // Do not let clay be dragged absurdly far from where it started.
      const ex = x - r[i * 3];
      const ey = y - r[i * 3 + 1];
      const ez = z - r[i * 3 + 2];
      const e = Math.hypot(ex, ey, ez);
      if (e > MAX_DISPLACEMENT) {
        const s = MAX_DISPLACEMENT / e;
        x = r[i * 3] + ex * s;
        y = r[i * 3 + 1] + ey * s;
        z = r[i * 3 + 2] + ez * s;
      }

      // Keep every vertex on its own side of the center, so a dent can never
      // push through the opposite wall or turn the blob inside out.
      const ux = r[i * 3] / BLOB_RADIUS;
      const uy = r[i * 3 + 1] / BLOB_RADIUS;
      const uz = r[i * 3 + 2] / BLOB_RADIUS;
      const proj = x * ux + y * uy + z * uz;
      if (proj < CORE_RADIUS) {
        const push = CORE_RADIUS - proj;
        x += ux * push;
        y += uy * push;
        z += uz * push;
      }

      m[i * 3] = x;
      m[i * 3 + 1] = y;
      m[i * 3 + 2] = z;
    }
  }

  endGrab(id: number) {
    this.grabs.delete(id);
  }

  isGrabbing(id: number) {
    return this.grabs.has(id);
  }

  get grabCount() {
    return this.grabs.size;
  }

  /* ------------------------------- physics --------------------------------- */

  /** Push the surface outward a little. Used for the "birth" jiggle. */
  kick(strength: number) {
    for (let i = 0; i < this.vertexCount; i++) {
      const ux = this.rest[i * 3] / BLOB_RADIUS;
      const uy = this.rest[i * 3 + 1] / BLOB_RADIUS;
      const uz = this.rest[i * 3 + 2] / BLOB_RADIUS;
      const variation = 0.6 + 0.4 * Math.sin(ux * 5.3 + uy * 4.1 + uz * 3.7);
      const s = strength * variation;
      this.vel[i * 3] += this.normalAttr.getX(i) * s;
      this.vel[i * 3 + 1] += this.normalAttr.getY(i) * s;
      this.vel[i * 3 + 2] += this.normalAttr.getZ(i) * s;
    }
  }

  step(dt: number, time: number, wobbleScale = 1) {
    const k = Math.min(Math.max(dt * 60, 0.25), 2.5);
    const n = this.vertexCount;

    // Which vertices are currently held by a pinch.
    this.grabWeight.fill(0);
    for (const grab of this.grabs.values()) {
      for (let i = 0; i < n; i++) {
        if (grab.local[i] > this.grabWeight[i]) this.grabWeight[i] = grab.local[i];
      }
    }

    this.smooth(k);
    this.conserveVolume(k);
    if (this.grabs.size === 0) this.recenter(k);

    const m = this.memory;
    const p = this.pos;
    const v = this.vel;
    const out = this.positionAttr.array as Float32Array;
    const normals = this.normalAttr.array as Float32Array;
    const influenceDecay = 1 - (1 - 0.9) * k;

    for (let i = 0; i < n; i++) {
      // Tight while pinched, loose and jiggly after release.
      const infl = Math.max(this.grabWeight[i], this.influence[i] * influenceDecay);
      this.influence[i] = infl;
      const stiffness = (SPRING + (SPRING_GRAB - SPRING) * infl) * k;
      const damping = 1 - (1 - (DAMPING + (DAMPING_GRAB - DAMPING) * infl)) * k;

      for (let a = 0; a < 3; a++) {
        const idx = i * 3 + a;
        v[idx] = (v[idx] + (m[idx] - p[idx]) * stiffness) * damping;
        p[idx] += v[idx] * k;
      }

      // Idle liquid ripple along the surface normal. Render only: it never
      // changes the clay shape.
      const ux = this.rest[i * 3] / BLOB_RADIUS;
      const uy = this.rest[i * 3 + 1] / BLOB_RADIUS;
      const uz = this.rest[i * 3 + 2] / BLOB_RADIUS;
      const w =
        WOBBLE *
        wobbleScale *
        (0.55 * Math.sin(3.0 * ux + 2.0 * uy + time * 1.15) +
          0.35 * Math.sin(4.1 * uy - 3.3 * uz + time * 0.83 + 1.7) +
          0.25 * Math.sin(2.2 * uz + 3.7 * ux - time * 0.95) +
          0.3 * Math.sin(time * 1.3));

      out[i * 3] = p[i * 3] + normals[i * 3] * w;
      out[i * 3 + 1] = p[i * 3 + 1] + normals[i * 3 + 1] * w;
      out[i * 3 + 2] = p[i * 3 + 2] + normals[i * 3 + 2] * w;
    }

    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.normalAttr.needsUpdate = true;
  }

  /** Surface tension: each vertex drifts toward the average of its neighbours. */
  private smooth(k: number) {
    const m = this.memory;
    const out = this.scratch;

    for (let i = 0; i < this.vertexCount; i++) {
      const start = this.neighborStart[i];
      const end = this.neighborStart[i + 1];
      const count = end - start;

      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let j = start; j < end; j++) {
        const nb = this.neighborList[j];
        ax += m[nb * 3];
        ay += m[nb * 3 + 1];
        az += m[nb * 3 + 2];
      }
      ax /= count;
      ay /= count;
      az /= count;

      // Pinched clay follows the fingers instead of being smoothed away.
      const f = SMOOTHING * k * (1 - this.grabWeight[i]);
      out[i * 3] = m[i * 3] + (ax - m[i * 3]) * f;
      out[i * 3 + 1] = m[i * 3 + 1] + (ay - m[i * 3 + 1]) * f;
      out[i * 3 + 2] = m[i * 3 + 2] + (az - m[i * 3 + 2]) * f;
    }

    m.set(out);
  }

  /** Clay does not get bigger or smaller when you shape it. */
  private conserveVolume(k: number) {
    const m = this.memory;
    const volume = this.measureVolume(m, this.centroid);
    if (!(volume > 1e-6)) return;

    const ratio = Math.cbrt(this.restVolume / volume);
    const s = 1 + (ratio - 1) * Math.min(1, VOLUME_BLEND * k);
    const c = this.centroid;

    for (let i = 0; i < this.vertexCount; i++) {
      const scale = 1 + (s - 1) * (1 - this.grabWeight[i]);
      m[i * 3] = c.x + (m[i * 3] - c.x) * scale;
      m[i * 3 + 1] = c.y + (m[i * 3 + 1] - c.y) * scale;
      m[i * 3 + 2] = c.z + (m[i * 3 + 2] - c.z) * scale;
    }
  }

  /**
   * Slide the shape back toward where the blob was born. Uses the part of the
   * body that has not been sculpted, so a pulled lump does not shove the body
   * the other way.
   */
  private recenter(k: number) {
    const m = this.memory;
    const r = this.rest;

    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sw = 0;
    for (let i = 0; i < this.vertexCount; i++) {
      const ex = m[i * 3] - r[i * 3];
      const ey = m[i * 3 + 1] - r[i * 3 + 1];
      const ez = m[i * 3 + 2] - r[i * 3 + 2];
      const d2 = ex * ex + ey * ey + ez * ez;
      const w = Math.exp(-d2 / 0.06);
      // Offset of this vertex from where it started. Untouched clay = 0.
      sx += ex * w;
      sy += ey * w;
      sz += ez * w;
      sw += w;
    }
    if (sw < this.vertexCount * 0.1) return;

    const f = Math.min(1, RECENTER * k) / sw;
    sx *= f;
    sy *= f;
    sz *= f;

    for (let i = 0; i < this.vertexCount; i++) {
      m[i * 3] -= sx;
      m[i * 3 + 1] -= sy;
      m[i * 3 + 2] -= sz;
    }
  }

  /**
   * Stretch the whole body along `axis` (local space, unit length) by `factor`,
   * squeezing the other two directions so volume is kept. Clay held by a pinch
   * is left alone: it follows the fingers.
   */
  stretch(axis: THREE.Vector3, factor: number) {
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-5) return;

    const m = this.memory;
    const c = this.centroid;
    const along = Math.min(1.08, Math.max(0.92, 1 + (factor - 1) * STRETCH_BLEND));
    const across = 1 / Math.sqrt(along);

    for (let i = 0; i < this.vertexCount; i++) {
      const px = m[i * 3] - c.x;
      const py = m[i * 3 + 1] - c.y;
      const pz = m[i * 3 + 2] - c.z;
      const par = px * axis.x + py * axis.y + pz * axis.z;

      // new = par * along * axis + perp * across
      const nx = axis.x * par * along + (px - axis.x * par) * across;
      const ny = axis.y * par * along + (py - axis.y * par) * across;
      const nz = axis.z * par * along + (pz - axis.z * par) * across;

      const free = 1 - this.grabWeight[i];
      m[i * 3] += (nx - px) * free;
      m[i * 3 + 1] += (ny - py) * free;
      m[i * 3 + 2] += (nz - pz) * free;
    }
  }

  private measureVolume(p: Float32Array, centroid?: THREE.Vector3) {
    let volume = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let t = 0; t < this.triangles.length; t += 3) {
      const a = this.triangles[t] * 3;
      const b = this.triangles[t + 1] * 3;
      const c = this.triangles[t + 2] * 3;

      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const qx = p[c], qy = p[c + 1], qz = p[c + 2];

      const v =
        (ax * (by * qz - bz * qy) -
          ay * (bx * qz - bz * qx) +
          az * (bx * qy - by * qx)) /
        6;

      volume += v;
      cx += (v * (ax + bx + qx)) / 4;
      cy += (v * (ay + by + qy)) / 4;
      cz += (v * (az + bz + qz)) / 4;
    }

    if (centroid && volume > 1e-9) {
      centroid.set(cx / volume, cy / volume, cz / volume);
    }
    return volume;
  }

  /* ------------------------------- helpers --------------------------------- */

  /** Current clay volume divided by the starting volume. */
  volumeRatio() {
    return this.measureVolume(this.memory) / this.restVolume;
  }

  /** Largest distance any clay vertex has moved from its start. */
  maxDisplacement() {
    let max = 0;
    for (let i = 0; i < this.vertexCount; i++) {
      max = Math.max(
        max,
        Math.hypot(
          this.memory[i * 3] - this.rest[i * 3],
          this.memory[i * 3 + 1] - this.rest[i * 3 + 1],
          this.memory[i * 3 + 2] - this.rest[i * 3 + 2]
        )
      );
    }
    return max;
  }

  /** Copy of the clay shape (for tests and debugging). */
  snapshot() {
    return Float32Array.from(this.memory);
  }

  reset() {
    this.memory.set(this.rest);
    this.pos.set(this.rest);
    this.vel.fill(0);
    this.influence.fill(0);
    this.grabs.clear();
  }

  dispose() {
    this.geometry.dispose();
  }
}
