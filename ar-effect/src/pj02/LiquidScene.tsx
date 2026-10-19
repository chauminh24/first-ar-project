import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

import { ClayBlob } from "./ClayBlob";
import { BLOB_PALETTES, type BlobPalette, type HandFrame, type HandSample, type InteractionMode } from "./types";

type LiquidSceneProps = {
  handRef: MutableRefObject<HandFrame>;
  blobActive: boolean;
  blobPalette: BlobPalette;
  resetVersion: number;
  /** 0..1 while both hands are held in view, drives the blob forming. */
  summonProgressRef: MutableRefObject<number>;
  onModeChange?: (mode: InteractionMode) => void;
};

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

const CAM_Z = 10;
/** Height of the z = 0 plane in scene units. Same framing as before. */
const VIEW_HEIGHT = 5;
const TAN_HALF_FOV = VIEW_HEIGHT / 2 / CAM_Z;
const FOV = THREE.MathUtils.radToDeg(2 * Math.atan(TAN_HALF_FOV));
/** Hand skeleton is drawn on this plane, in front of the blob. */
const OVERLAY_Z = 1.15;

/**
 * Depth dial. Scene units of push / pull per unit of hand depth change.
 * Roughly: moving a hand 10 cm toward the camera moves the clay ~0.8 units.
 * Raise it if z feels too weak, lower it if z feels too jumpy.
 */
const Z_GAIN = 9;
const Z_LIMIT = 1.6;

/** A pinch grabs the clay if it lands this close to the blob (scene units). */
const GRAB_REACH = 0.4;
/** Deltas are ignored unless the pinch is firm, so opening the fingers does not drag the clay. */
const FIRM_PINCH = 0.5;
/** Frames after a pinch starts where the cursor is re-anchored instead of dragging. */
const SETTLE_FRAMES = 4;
/** Radians per scene unit when spinning the blob with an empty-air pinch. */
const ROTATE_GAIN = 1.5;
const IDLE_SPIN = 0.12;

const FORM_START = 0.18;
const FORM_END = 0.82;

const COLOR_OPEN = new THREE.Color("#ffffff");
const COLOR_GRAB = new THREE.Color("#7df3ff");
const COLOR_ROTATE = new THREE.Color("#ffd27a");

/* -------------------------------------------------------------------------- */

type HandState = {
  mode: "none" | "grab" | "rotate";
  depthStart: number;
  planeZ: number;
  settle: number;
  /** Last cursor position in world space. */
  prev: THREE.Vector3;
  /** Where the grabbed clay point is in world space. */
  tip: THREE.Vector3;
};

function newHandState(): HandState {
  return {
    mode: "none",
    depthStart: 0,
    planeZ: 0,
    settle: 0,
    prev: new THREE.Vector3(),
    tip: new THREE.Vector3(),
  };
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

export function LiquidScene({
  handRef,
  blobActive,
  blobPalette,
  resetVersion,
  summonProgressRef,
  onModeChange,
}: LiquidSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobActiveRef = useRef(blobActive);
  const blobPaletteRef = useRef(blobPalette);
  const onModeChangeRef = useRef(onModeChange);

  useEffect(() => {
    blobActiveRef.current = blobActive;
  }, [blobActive]);

  useEffect(() => {
    blobPaletteRef.current = blobPalette;
  }, [blobPalette]);

  useEffect(() => {
    onModeChangeRef.current = onModeChange;
  }, [onModeChange]);

  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;
    const container: HTMLDivElement = containerElement;

    const scene = new THREE.Scene();
    // Perspective camera so z is real: pulling clay toward you makes it bigger.
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAM_Z);
    camera.updateMatrixWorld();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    /* ------------------------------ the blob ------------------------------ */

    const clay = new ClayBlob();
    const initialPalette = BLOB_PALETTES[blobPaletteRef.current];
    const material = new THREE.MeshPhysicalMaterial({
      color: initialPalette.color,
      metalness: 0.12,
      roughness: 0.1,
      transmission: 0.12,
      thickness: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: initialPalette.emissive,
      emissiveIntensity: 0.32,
    });
    const blob = new THREE.Mesh(clay.geometry, material);
    blob.visible = false;
    blob.frustumCulled = false;
    blob.scale.setScalar(0.0001);
    scene.add(blob);

    scene.add(new THREE.AmbientLight("#ffffff", 1.35));

    const keyLight = new THREE.DirectionalLight("#ffffff", 3.5);
    keyLight.position.set(3, 5, 6);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(initialPalette.rim, 22, 15);
    rimLight.position.set(-3, 1, 4);
    scene.add(rimLight);

    /* --------------------------- hand overlay ----------------------------- */

    const skeletonMaterial = new THREE.LineBasicMaterial({
      color: "#8eeaff",
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const landmarkMaterial = new THREE.PointsMaterial({
      color: "#ffffff",
      size: 0.065,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const skeletonGeometry = new THREE.BufferGeometry();
    const skeletonPositions = new Float32Array(2 * HAND_CONNECTIONS.length * 2 * 3);
    skeletonGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(skeletonPositions, 3)
    );
    const skeleton = new THREE.LineSegments(skeletonGeometry, skeletonMaterial);
    skeleton.renderOrder = 10;
    skeleton.frustumCulled = false;
    scene.add(skeleton);

    const landmarkGeometry = new THREE.BufferGeometry();
    const landmarkPositions = new Float32Array(2 * 21 * 3);
    landmarkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(landmarkPositions, 3)
    );
    const landmarkPoints = new THREE.Points(landmarkGeometry, landmarkMaterial);
    landmarkPoints.renderOrder = 11;
    landmarkPoints.frustumCulled = false;
    scene.add(landmarkPoints);

    // One cursor per hand: a dot at the pinch point, and a ring that sits on
    // the clay being held (or around the dot while spinning).
    const dotGeometry = new THREE.SphereGeometry(1, 20, 14);
    const ringGeometry = new THREE.RingGeometry(0.86, 1, 48);
    const dots: THREE.Mesh[] = [];
    const rings: THREE.Mesh[] = [];
    for (let slot = 0; slot < 2; slot++) {
      const dot = new THREE.Mesh(
        dotGeometry,
        new THREE.MeshBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        })
      );
      dot.renderOrder = 12;
      dot.visible = false;
      scene.add(dot);
      dots.push(dot);

      const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: "#7df3ff",
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          side: THREE.DoubleSide,
        })
      );
      ring.renderOrder = 12;
      ring.visible = false;
      scene.add(ring);
      rings.push(ring);
    }

    /* ------------------------------ sizing -------------------------------- */

    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    /* ----------------------------- projection ----------------------------- */

    /**
     * Webcam coordinates (0..1, mirrored to match the preview) to a point on
     * the plane z = planeZ, so the point appears right under the finger.
     */
    function toPlane(x: number, y: number, planeZ: number, out: THREE.Vector3) {
      const halfH = TAN_HALF_FOV * (CAM_Z - planeZ);
      const halfW = halfH * camera.aspect;
      return out.set((0.5 - x) * 2 * halfW, (0.5 - y) * 2 * halfH, planeZ);
    }

    /** Direction of the camera ray through a webcam point. */
    function rayDirection(x: number, y: number, out: THREE.Vector3) {
      return out
        .set(
          (0.5 - x) * 2 * TAN_HALF_FOV * camera.aspect,
          (0.5 - y) * 2 * TAN_HALF_FOV,
          -1
        )
        .normalize();
    }

    /* ------------------------------ state --------------------------------- */

    let animationFrame = 0;
    let disposed = false;
    let lastTime = performance.now();
    let time = 0;

    const states = [newHandState(), newHandState()];
    let lastMode: InteractionMode = "idle";
    let currentPalette = blobPaletteRef.current;

    let placed = false;
    let wasActive = false;
    let activeSince = 0;
    let depthRef = 0;
    let glow = 0;
    let scaleValue = 0;
    let scaleVelocity = 0;
    let previousSeparation = -1;

    const omega = new THREE.Vector3(0, IDLE_SPIN, 0);
    const handOmega = new THREE.Vector3();
    const idleOmega = new THREE.Vector3(0, IDLE_SPIN, 0);

    const formTarget = new THREE.Vector3();
    const originWorld = new THREE.Vector3(0, 0, CAM_Z);
    const directionWorld = new THREE.Vector3();
    const originLocal = new THREE.Vector3();
    const directionLocal = new THREE.Vector3();
    const inverseMatrix = new THREE.Matrix4();
    const inverseQuaternion = new THREE.Quaternion();
    const cursor = new THREE.Vector3();
    const delta = new THREE.Vector3();
    const deltaLocal = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const separation = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const spin = new THREE.Quaternion();
    const spinX = new THREE.Quaternion();
    const spinY = new THREE.Quaternion();
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    const AXIS_Y = new THREE.Vector3(0, 1, 0);

    function endHand(id: number) {
      const state = states[id];
      if (state.mode === "grab") clay.endGrab(id);
      state.mode = "none";
    }

    function beginPinch(hand: HandSample, state: HandState) {
      const { x, y } = hand.pinchPoint;

      // Ray from the camera through the fingers, into the blob's own space.
      rayDirection(x, y, directionWorld);
      originLocal.copy(originWorld).applyMatrix4(inverseMatrix);
      directionLocal.copy(directionWorld).transformDirection(inverseMatrix);

      const pick = clay.pick(originLocal, directionLocal);
      state.settle = SETTLE_FRAMES;
      state.depthStart = hand.depth;

      if (pick && pick.rayDistance < GRAB_REACH) {
        // Pinching the clay: grab it where the fingers are pointing.
        clay.beginGrab(hand.id, pick.index);
        clay.getRenderPosition(pick.index, tmp).applyMatrix4(blob.matrixWorld);
        state.mode = "grab";
        state.planeZ = tmp.z;
        state.tip.copy(tmp);
        toPlane(x, y, state.planeZ, state.prev);
      } else {
        // Pinching empty air: grab the space around the blob and spin it.
        state.mode = "rotate";
        state.planeZ = 0;
        toPlane(x, y, 0, state.prev);
      }
    }

    function animate() {
      if (disposed) return;
      animationFrame = requestAnimationFrame(animate);

      const nowMs = performance.now();
      if (currentPalette !== blobPaletteRef.current) {
        currentPalette = blobPaletteRef.current;
        const palette = BLOB_PALETTES[currentPalette];
        material.color.set(palette.color);
        material.emissive.set(palette.emissive);
        rimLight.color.set(palette.rim);
      }

      const dt = Math.min((nowMs - lastTime) / 1000, 0.05);
      lastTime = nowMs;
      time += dt;
      const k = Math.min(Math.max(dt * 60, 0.25), 2.5);

      const hands = handRef.current.slice(0, 2);
      const hasHands = hands.length > 0;

      /* ---- hand skeleton (same screen-space overlay as before) ---- */

      skeleton.visible = hasHands;
      landmarkPoints.visible = hasHands;
      skeletonPositions.fill(0);
      landmarkPositions.fill(0);

      const overlayHalfH = TAN_HALF_FOV * (CAM_Z - OVERLAY_Z);
      const overlayHalfW = overlayHalfH * camera.aspect;

      hands.forEach((hand, handIndex) => {
        let cursorIndex = handIndex * HAND_CONNECTIONS.length * 6;

        for (const [start, end] of HAND_CONNECTIONS) {
          const a = hand.landmarks[start];
          const b = hand.landmarks[end];

          skeletonPositions[cursorIndex++] = (0.5 - a.x) * 2 * overlayHalfW;
          skeletonPositions[cursorIndex++] = (0.5 - a.y) * 2 * overlayHalfH;
          skeletonPositions[cursorIndex++] = OVERLAY_Z;

          skeletonPositions[cursorIndex++] = (0.5 - b.x) * 2 * overlayHalfW;
          skeletonPositions[cursorIndex++] = (0.5 - b.y) * 2 * overlayHalfH;
          skeletonPositions[cursorIndex++] = OVERLAY_Z;
        }

        const pointOffset = handIndex * 21 * 3;
        for (let i = 0; i < 21; i++) {
          const point = hand.landmarks[i];
          landmarkPositions[pointOffset + i * 3] = (0.5 - point.x) * 2 * overlayHalfW;
          landmarkPositions[pointOffset + i * 3 + 1] = (0.5 - point.y) * 2 * overlayHalfH;
          landmarkPositions[pointOffset + i * 3 + 2] = OVERLAY_Z + 0.01;
        }
      });

      skeletonGeometry.attributes.position.needsUpdate = true;
      landmarkGeometry.attributes.position.needsUpdate = true;
      skeletonGeometry.setDrawRange(0, hands.length * HAND_CONNECTIONS.length * 2);
      landmarkGeometry.setDrawRange(0, hands.length * 21);

      /* ---- forming, then locking in place ---- */

      const active = blobActiveRef.current;
      const progress = summonProgressRef.current;
      const bothPresent = hands.length >= 2;

      if (!active && bothPresent) {
        // While you hold both hands up, the liquid condenses between the palms.
        const midX = (hands[0].palmCenter.x + hands[1].palmCenter.x) / 2;
        const midY = (hands[0].palmCenter.y + hands[1].palmCenter.y) / 2;
        toPlane(midX, midY, 0, formTarget);

        if (!placed) {
          blob.position.copy(formTarget);
          placed = true;
        } else {
          blob.position.lerp(formTarget, 1 - 0.75 ** k);
        }
      }

      if (active && !wasActive) {
        // The moment it is born. From here on the position never changes, so it
        // stays exactly where it appeared between your hands.
        wasActive = true;
        activeSince = time;
        if (!placed) {
          blob.position.set(0, 0, 0);
          placed = true;
          scaleValue = FORM_END;
        }
        depthRef = hands.length
          ? hands.reduce((sum, hand) => sum + hand.depth, 0) / hands.length
          : 0;
        scaleVelocity += 0.03;
        glow = 0.55;
        clay.kick(0.02);
      }

      let scaleTarget = 0;
      if (active) {
        scaleTarget = 1;
      } else if (bothPresent && progress > 0.001) {
        scaleTarget = FORM_START + (FORM_END - FORM_START) * easeOutCubic(progress);
      }

      scaleVelocity += (scaleTarget - scaleValue) * 0.1 * k;
      scaleVelocity *= 1 - 0.2 * k;
      scaleValue = Math.max(0, scaleValue + scaleVelocity * k);

      blob.scale.setScalar(Math.max(scaleValue, 0.0001));
      blob.visible = scaleValue > 0.02;

      if (!active) {
        glow = bothPresent ? 0.55 * progress : glow * 0.9 ** k;
      } else {
        glow *= 0.97 ** k;
      }
      material.emissiveIntensity = 0.32 + glow;

      /* ---- hand interaction ---- */

      const interactive = active && scaleValue > 0.9 && time - activeSince > 0.6;

      blob.updateMatrixWorld();
      inverseMatrix.copy(blob.matrixWorld).invert();
      inverseQuaternion.copy(blob.quaternion).invert();

      const seen = [false, false];
      let rotatingHands = 0;
      let rotateX = 0;
      let rotateY = 0;

      if (interactive) {
        for (const hand of hands) {
          seen[hand.id] = true;
          const state = states[hand.id];

          if (!hand.isPinching) {
            if (state.mode !== "none") endHand(hand.id);
            continue;
          }

          if (state.mode === "none") beginPinch(hand, state);

          const { x, y } = hand.pinchPoint;
          const firm = hand.pinchRatio < FIRM_PINCH && state.settle <= 0;

          if (state.mode === "grab") {
            // x/y come from where the fingers are on screen. z comes from how
            // much closer or farther the hand moved since the pinch began.
            const dz = THREE.MathUtils.clamp(
              (state.depthStart - hand.depth) * Z_GAIN,
              -Z_LIMIT,
              Z_LIMIT
            );
            toPlane(x, y, state.planeZ + dz, cursor);

            if (firm) {
              delta.copy(cursor).sub(state.prev);
              deltaLocal
                .copy(delta)
                .applyQuaternion(inverseQuaternion)
                .divideScalar(blob.scale.x);
              clay.moveGrab(hand.id, deltaLocal.x, deltaLocal.y, deltaLocal.z);
              state.tip.add(delta);
            }
            state.prev.copy(cursor);
          } else if (state.mode === "rotate") {
            toPlane(x, y, 0, cursor);
            if (firm) {
              delta.copy(cursor).sub(state.prev);
              rotateX += -delta.y * ROTATE_GAIN;
              rotateY += delta.x * ROTATE_GAIN;
              rotatingHands += 1;
            }
            state.prev.copy(cursor);
          }

          if (state.settle > 0) state.settle -= 1;
        }
      }

      for (let id = 0; id < 2; id++) {
        if (!seen[id] && states[id].mode !== "none") endHand(id);
      }

      const grabbing = states.filter((state) => state.mode === "grab");
      const anyGrab = grabbing.length > 0;
      const anyRotate = states.some((state) => state.mode === "rotate");

      // Two hands holding the clay: stretch the whole body between them, like
      // pulling a lump of dough apart. Volume is kept.
      if (grabbing.length === 2) {
        separation
          .copy(states[1].tip)
          .sub(states[0].tip)
          .applyQuaternion(inverseQuaternion);
        const length = separation.length();

        if (length > 0.25 && previousSeparation > 0.25) {
          axis.copy(separation).divideScalar(length);
          clay.stretch(axis, length / previousSeparation);
        }
        previousSeparation = length;
      } else {
        previousSeparation = -1;
      }

      /* ---- spin: idle drift, grab-the-air rotate, and inertia ---- */

      if (rotatingHands > 0) {
        const ax = rotateX / rotatingHands;
        const ay = rotateY / rotatingHands;
        spinX.setFromAxisAngle(AXIS_X, ax);
        spinY.setFromAxisAngle(AXIS_Y, ay);
        blob.quaternion.premultiply(spinY).premultiply(spinX);

        // Remember the speed so letting go keeps it spinning for a moment.
        const inv = 1 / Math.max(dt, 1 / 120);
        tmp.set(ax * inv, ay * inv, 0);
        if (tmp.length() > 8) tmp.setLength(8);
        handOmega.lerp(tmp, 0.35);
        omega.copy(handOmega);
      } else {
        handOmega.set(0, 0, 0);
        if (anyGrab) {
          // Hold still while sculpting so the clay does not slide under your fingers.
          omega.lerp(handOmega, 1 - 0.8 ** k);
        } else {
          omega.lerp(idleOmega, 1 - 0.97 ** k);
        }

        const angle = omega.length() * dt;
        if (angle > 1e-6) {
          axis.copy(omega).normalize();
          spin.setFromAxisAngle(axis, angle);
          blob.quaternion.premultiply(spin);
        }
      }
      blob.quaternion.normalize();

      /* ---- clay physics ---- */

      if (blob.visible) {
        clay.step(dt, time, active ? 1 : 0.8);
      }

      /* ---- cursors ---- */

      for (let slot = 0; slot < 2; slot++) {
        const hand = hands.find((candidate) => candidate.id === slot);
        const dot = dots[slot];
        const ring = rings[slot];

        if (!hand) {
          dot.visible = false;
          ring.visible = false;
          continue;
        }

        const state = states[slot];
        const dotMaterial = dot.material as THREE.MeshBasicMaterial;
        const ringMaterial = ring.material as THREE.MeshBasicMaterial;

        toPlane(hand.pinchPoint.x, hand.pinchPoint.y, OVERLAY_Z + 0.02, dot.position);
        // Closer to the camera than when you summoned = bigger dot.
        const depthScale = depthRef > 0
          ? THREE.MathUtils.clamp(depthRef / hand.depth, 0.6, 1.7)
          : 1;
        dot.scale.setScalar(0.03 * depthScale * (1 + 0.8 * (1 - hand.pinchStrength)));
        dot.visible = true;
        dotMaterial.color.copy(
          state.mode === "grab"
            ? COLOR_GRAB
            : state.mode === "rotate"
              ? COLOR_ROTATE
              : COLOR_OPEN
        );

        if (state.mode === "grab") {
          ring.position.copy(state.tip);
          ring.scale.setScalar(0.13 + 0.01 * Math.sin(time * 6));
          ringMaterial.color.copy(COLOR_GRAB);
          ring.visible = true;
        } else if (state.mode === "rotate") {
          ring.position.copy(dot.position);
          ring.scale.setScalar(0.17);
          ringMaterial.color.copy(COLOR_ROTATE);
          ring.visible = true;
        } else {
          ring.visible = false;
        }
      }

      /* ---- report what the hands are doing ---- */

      const mode: InteractionMode = anyGrab ? "sculpt" : anyRotate ? "rotate" : "idle";
      if (mode !== lastMode) {
        lastMode = mode;
        onModeChangeRef.current?.(mode);
      }

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      clay.dispose();
      material.dispose();
      skeletonGeometry.dispose();
      landmarkGeometry.dispose();
      skeletonMaterial.dispose();
      landmarkMaterial.dispose();
      dotGeometry.dispose();
      ringGeometry.dispose();
      dots.forEach((dot) => (dot.material as THREE.Material).dispose());
      rings.forEach((ring) => (ring.material as THREE.Material).dispose());
      renderer.dispose();
      renderer.domElement.remove();
      onModeChangeRef.current?.("idle");
    };
  }, [handRef, summonProgressRef, resetVersion]);

  return <div ref={containerRef} className="h-full w-full" />;
}
