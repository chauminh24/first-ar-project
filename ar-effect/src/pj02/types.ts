export type HandPoint = {
  x: number;
  y: number;
  z: number;
};

export type HandSample = {
  /** Stable slot (0 or 1). A hand keeps the same id between frames. */
  id: number;
  /** 21 MediaPipe landmarks in normalized webcam coordinates (smoothed). */
  landmarks: HandPoint[];
  indexTip: HandPoint;
  thumbTip: HandPoint;
  /** Midpoint between thumb tip and index tip. This is the "pinch cursor". */
  pinchPoint: HandPoint;
  palmCenter: HandPoint;
  /** Relative apparent hand size in the image. */
  palmScale: number;
  /**
   * Relative distance from the camera (smaller = closer). Estimated from the
   * metric hand size vs. the size in the image, so it stays stable when the
   * hand rotates. Arbitrary units, only differences matter.
   */
  depth: number;
  /** Thumb-index gap divided by palm size. Small = pinched. */
  pinchRatio: number;
  /** 0 = open, 1 = fully pinched. */
  pinchStrength: number;
  /** Debounced with hysteresis, so it does not flicker at the threshold. */
  isPinching: boolean;
  /** True when the hand dropped out for a few frames and its last pose is held. */
  held: boolean;
};

export type HandFrame = HandSample[];

export type InteractionMode = "idle" | "sculpt" | "rotate";

export const BLOB_PALETTES = {
  blue: { label: "Blue", color: "#70baff", emissive: "#063c86", rim: "#468aff" },
  pink: { label: "Pink", color: "#ff70d6", emissive: "#78104f", rim: "#ff4fc3" },
  yellow: { label: "Yellow", color: "#ffe45e", emissive: "#705600", rim: "#ffe66d" },
  orange: { label: "Orange", color: "#ff9b42", emissive: "#7d3100", rim: "#ff8a36" },
  green: { label: "Green", color: "#65ff8f", emissive: "#075c2e", rim: "#39ff79" },
} as const;

export type BlobPalette = keyof typeof BLOB_PALETTES;
