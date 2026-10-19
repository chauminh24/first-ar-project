import {
  FilesetResolver,
  HandLandmarker as MediaPipeHandLandmarker,
} from "@mediapipe/tasks-vision";

import type { HandFrame, HandPoint, HandSample } from "./types";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/* -------------------------------------------------------------------------- */
/* Tuning. Everything you might want to adjust by feel lives here.            */
/* -------------------------------------------------------------------------- */

/** One Euro filter for landmarks: lower min cutoff = calmer at rest. */
const LANDMARK_MIN_CUTOFF = 1.4;
/** Higher beta = the filter opens up faster when the hand moves fast. */
const LANDMARK_BETA = 14;
/** Depth is noisy, so it gets a much heavier filter. */
const DEPTH_MIN_CUTOFF = 0.8;
const DEPTH_BETA = 1.5;

/** Pinch ratio = thumb-index gap / palm size (3D, from world landmarks). */
const PINCH_ON = 0.4;
const PINCH_OFF = 0.62;
/** Pinch must stay open this long before it counts as released. */
const PINCH_RELEASE_MS = 66;

/** A hand that disappears keeps its last pose for this long. */
const HOLD_MS = 160;
/** A track can be re-matched to a returning hand for this long. */
const TRACK_TTL_MS = 700;
/** Max palm travel (normalized image units) to match a detection to a track. */
const MATCH_MAX_DIST = 0.5;

/* -------------------------------------------------------------------------- */

class OneEuroFilter {
  private x = 0;
  private dx = 0;
  private t = -1;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff = 1
  ) {}

  private static alpha(dt: number, cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.t = -1;
  }

  filter(value: number, timeMs: number) {
    if (this.t < 0) {
      this.x = value;
      this.dx = 0;
      this.t = timeMs;
      return value;
    }

    const dt = Math.max((timeMs - this.t) / 1000, 1 / 240);
    this.t = timeMs;

    const rawDx = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(dt, this.dCutoff) * (rawDx - this.dx);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

type Detection = {
  landmarks: HandPoint[];
  world: HandPoint[] | null;
  palm: { x: number; y: number };
};

type Track = {
  id: number;
  landmarkFilters: OneEuroFilter[];
  depthFilter: OneEuroFilter;
  pinchFilter: OneEuroFilter;
  pinching: boolean;
  releaseSince: number | null;
  lastSeen: number;
  lastPalm: { x: number; y: number };
  lastDepth: number;
  sample: HandSample | null;
};

function makeTrack(id: number): Track {
  return {
    id,
    landmarkFilters: Array.from(
      { length: 21 * 3 },
      () => new OneEuroFilter(LANDMARK_MIN_CUTOFF, LANDMARK_BETA)
    ),
    depthFilter: new OneEuroFilter(DEPTH_MIN_CUTOFF, DEPTH_BETA),
    pinchFilter: new OneEuroFilter(3, 2),
    pinching: false,
    releaseSince: null,
    lastSeen: -Infinity,
    lastPalm: { x: 0.5, y: 0.5 },
    lastDepth: 0.45,
    sample: null,
  };
}

function resetTrack(track: Track) {
  track.landmarkFilters.forEach((filter) => filter.reset());
  track.depthFilter.reset();
  track.pinchFilter.reset();
  track.pinching = false;
  track.releaseSince = null;
  track.sample = null;
}

function dist3(a: HandPoint, b: HandPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Wrist and knuckle spans. These do not change when fingers curl, so pinching
 * does not disturb the depth estimate.
 */
const DEPTH_PAIRS: Array<[number, number]> = [
  [0, 5],
  [0, 9],
  [0, 13],
  [0, 17],
  [5, 17],
];

/**
 * Relative distance to the camera.
 *
 * distance ~ focal * (real size) / (size in image). MediaPipe gives metric
 * world landmarks, so we compare the same spans measured in meters (x/y only,
 * which is what the camera sees) against the image. That ratio does not shrink
 * when the palm tilts, unlike raw palm size.
 */
function estimateDepth(
  landmarks: HandPoint[],
  world: HandPoint[] | null,
  aspect: number
): number | null {
  let imageSum = 0;
  let worldSum = 0;

  for (const [a, b] of DEPTH_PAIRS) {
    imageSum += Math.hypot(
      (landmarks[a].x - landmarks[b].x) * aspect,
      landmarks[a].y - landmarks[b].y
    );
    if (world) {
      worldSum += Math.hypot(
        world[a].x - world[b].x,
        world[a].y - world[b].y
      );
    }
  }

  if (imageSum < 0.02) return null;
  // Without world landmarks, assume an average hand (about 0.42 m summed span).
  return (world && worldSum > 0.01 ? worldSum : 0.42) / imageSum;
}

function estimatePinchRatio(
  landmarks: HandPoint[],
  world: HandPoint[] | null,
  aspect: number
) {
  if (world) {
    const size = dist3(world[0], world[9]);
    return dist3(world[4], world[8]) / Math.max(size, 1e-4);
  }

  const size = Math.hypot(
    (landmarks[0].x - landmarks[9].x) * aspect,
    landmarks[0].y - landmarks[9].y
  );
  const gap = Math.hypot(
    (landmarks[4].x - landmarks[8].x) * aspect,
    landmarks[4].y - landmarks[8].y
  );
  return gap / Math.max(size, 1e-4);
}

export class HandTracker {
  private landmarker: MediaPipeHandLandmarker | null = null;
  private lastVideoTime = -1;
  private tracks: Track[] = [makeTrack(0), makeTrack(1)];
  private lastFrame: HandFrame = [];

  async initialize() {
    if (this.landmarker) return;

    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

    const create = (delegate: "GPU" | "CPU") =>
      MediaPipeHandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    try {
      this.landmarker = await create("GPU");
    } catch (error) {
      console.warn("GPU hand tracking failed, falling back to CPU.", error);
      this.landmarker = await create("CPU");
    }
  }

  detect(video: HTMLVideoElement): HandFrame {
    if (
      !this.landmarker ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return [];
    }

    if (video.currentTime === this.lastVideoTime) return this.lastFrame;
    this.lastVideoTime = video.currentTime;

    const now = performance.now();
    const result = this.landmarker.detectForVideo(video, now);
    const aspect =
      video.videoWidth && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : 16 / 9;

    const detections: Detection[] = [];
    const rawHands = result.landmarks ?? [];
    const rawWorld = result.worldLandmarks ?? [];

    rawHands.forEach((raw, index) => {
      if (raw.length < 21) return;
      const landmarks = raw.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const worldRaw = rawWorld[index];
      const world =
        worldRaw && worldRaw.length >= 21
          ? worldRaw.map((p) => ({ x: p.x, y: p.y, z: p.z }))
          : null;

      detections.push({
        landmarks,
        world,
        palm: {
          x: (landmarks[0].x + landmarks[9].x) / 2,
          y: (landmarks[0].y + landmarks[9].y) / 2,
        },
      });
    });

    const matches = this.assign(detections, now);

    for (const [track, detection] of matches) {
      track.sample = this.update(track, detection, aspect, now);
      track.lastSeen = now;
      track.lastPalm = detection.palm;
    }

    const frame: HandFrame = [];
    for (const track of this.tracks) {
      if (!track.sample) continue;
      const age = now - track.lastSeen;
      if (age > HOLD_MS) continue;

      frame.push(age > 0 ? { ...track.sample, held: true } : track.sample);
    }

    this.lastFrame = frame;
    return frame;
  }

  /**
   * Keep each physical hand in the same slot between frames. MediaPipe does
   * not guarantee detection order, so using the raw order makes the two hands
   * swap and the blob jump.
   */
  private assign(detections: Detection[], now: number) {
    const result = new Map<Track, Detection>();
    const usedTracks = new Set<Track>();
    const usedDetections = new Set<number>();

    const pairs: Array<{ track: Track; index: number; dist: number }> = [];
    for (const track of this.tracks) {
      if (!track.sample || now - track.lastSeen > TRACK_TTL_MS) continue;
      detections.forEach((detection, index) => {
        pairs.push({
          track,
          index,
          dist: Math.hypot(
            track.lastPalm.x - detection.palm.x,
            track.lastPalm.y - detection.palm.y
          ),
        });
      });
    }
    pairs.sort((a, b) => a.dist - b.dist);

    for (const pair of pairs) {
      if (pair.dist > MATCH_MAX_DIST) break;
      if (usedTracks.has(pair.track) || usedDetections.has(pair.index)) continue;
      usedTracks.add(pair.track);
      usedDetections.add(pair.index);
      result.set(pair.track, detections[pair.index]);
    }

    detections.forEach((detection, index) => {
      if (usedDetections.has(index)) return;

      const free = this.tracks
        .filter((track) => !usedTracks.has(track))
        .sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (!free) return;

      resetTrack(free);
      usedTracks.add(free);
      usedDetections.add(index);
      result.set(free, detection);
    });

    return result;
  }

  private update(
    track: Track,
    detection: Detection,
    aspect: number,
    now: number
  ): HandSample {
    const { landmarks: rawLandmarks, world } = detection;

    const landmarks: HandPoint[] = rawLandmarks.map((point, i) => ({
      x: track.landmarkFilters[i * 3].filter(point.x, now),
      y: track.landmarkFilters[i * 3 + 1].filter(point.y, now),
      z: track.landmarkFilters[i * 3 + 2].filter(point.z, now),
    }));

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleMcp = landmarks[9];

    const rawDepth = estimateDepth(rawLandmarks, world, aspect);
    const depth = track.depthFilter.filter(rawDepth ?? track.lastDepth, now);
    track.lastDepth = depth;

    const pinchRatio = track.pinchFilter.filter(
      estimatePinchRatio(rawLandmarks, world, aspect),
      now
    );

    if (!track.pinching) {
      if (pinchRatio < PINCH_ON) {
        track.pinching = true;
        track.releaseSince = null;
      }
    } else if (pinchRatio > PINCH_OFF) {
      track.releaseSince ??= now;
      if (now - track.releaseSince >= PINCH_RELEASE_MS) {
        track.pinching = false;
        track.releaseSince = null;
      }
    } else {
      track.releaseSince = null;
    }

    const pinchStrength = Math.min(
      1,
      Math.max(0, (0.85 - pinchRatio) / (0.85 - 0.25))
    );

    return {
      id: track.id,
      landmarks,
      indexTip,
      thumbTip,
      pinchPoint: {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2,
        z: (thumbTip.z + indexTip.z) / 2,
      },
      palmCenter: {
        x: (wrist.x + middleMcp.x) / 2,
        y: (wrist.y + middleMcp.y) / 2,
        z: (wrist.z + middleMcp.z) / 2,
      },
      palmScale: Math.max(dist3(wrist, middleMcp), 0.0001),
      depth,
      pinchRatio,
      pinchStrength,
      isPinching: track.pinching,
      held: false,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastFrame = [];
    this.tracks.forEach(resetTrack);
  }
}
