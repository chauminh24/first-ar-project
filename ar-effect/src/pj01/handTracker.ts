import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'

const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type FingerPoint = {
  x: number
  y: number
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null
  private lastVideoTime = -1

  async initialize() {
    const vision =
      await FilesetResolver.forVisionTasks(
        WASM_PATH
      )

    this.landmarker =
      await HandLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'GPU',
          },

          runningMode: 'VIDEO',

          numHands: 1,

          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }
      )
  }

  detect(
    video: HTMLVideoElement
  ): FingerPoint | null {

    if (!this.landmarker) {
      return null
    }

    if (
      video.readyState < 2 ||
      video.currentTime === this.lastVideoTime
    ) {
      return null
    }

    this.lastVideoTime =
      video.currentTime

    const result: HandLandmarkerResult =
      this.landmarker.detectForVideo(
        video,
        performance.now()
      )

    if (!result.landmarks.length) {
      return null
    }

    const hand =
      result.landmarks[0]

    // ==========================================
    // LANDMARKS
    // ==========================================

    const wrist = hand[0]

    // Index
    const indexMcp = hand[5]
    const indexPip = hand[6]
    const indexTip = hand[8]

    // Middle
    const middleMcp = hand[9]
    const middlePip = hand[10]
    const middleTip = hand[12]

    // Ring
    const ringMcp = hand[13]
    const ringPip = hand[14]
    const ringTip = hand[16]

    // Pinky
    const pinkyMcp = hand[17]
    const pinkyPip = hand[18]
    const pinkyTip = hand[20]

    // ==========================================
    // DISTANCE
    // ==========================================

    const distance = (
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {

      return Math.hypot(
        a.x - b.x,
        a.y - b.y
      )
    }

    // ==========================================
    // FINGER EXTENSION
    // ==========================================

    /*
     * An open palm has:
     *
     * fingertip
     *     ↓
     *   PIP
     *     ↓
     *   MCP
     *     ↓
     *   wrist
     *
     * The fingertip should therefore be
     * substantially farther from the wrist
     * than the PIP joint.
     */

    const indexExtended =
      distance(
        indexTip,
        wrist
      ) >
      distance(
        indexPip,
        wrist
      ) * 1.12

    const middleExtended =
      distance(
        middleTip,
        wrist
      ) >
      distance(
        middlePip,
        wrist
      ) * 1.12

    const ringExtended =
      distance(
        ringTip,
        wrist
      ) >
      distance(
        ringPip,
        wrist
      ) * 1.10

    const pinkyExtended =
      distance(
        pinkyTip,
        wrist
      ) >
      distance(
        pinkyPip,
        wrist
      ) * 1.08

    // ==========================================
    // FINGER LENGTH
    // ==========================================

    /*
     * Additional check:
     *
     * The whole finger should extend away
     * from the palm.
     */

    const indexLength =
      distance(
        indexMcp,
        indexTip
      )

    const middleLength =
      distance(
        middleMcp,
        middleTip
      )

    const ringLength =
      distance(
        ringMcp,
        ringTip
      )

    const pinkyLength =
      distance(
        pinkyMcp,
        pinkyTip
      )

    const indexPalm =
      distance(
        wrist,
        indexMcp
      )

    const middlePalm =
      distance(
        wrist,
        middleMcp
      )

    const ringPalm =
      distance(
        wrist,
        ringMcp
      )

    const pinkyPalm =
      distance(
        wrist,
        pinkyMcp
      )

    const fingersLongEnough =
      indexLength > indexPalm * 0.65 &&
      middleLength > middlePalm * 0.65 &&
      ringLength > ringPalm * 0.55 &&
      pinkyLength > pinkyPalm * 0.45

    // ==========================================
    // OPEN PALM
    // ==========================================

    const openPalm =
      indexExtended &&
      middleExtended &&
      ringExtended &&
      pinkyExtended &&
      fingersLongEnough

    if (!openPalm) {
      return null
    }

    // ==========================================
    // RETURN INDEX FINGERTIP
    // ==========================================

    /*
     * The index fingertip becomes the point
     * where the water interaction happens.
     */

    return {
      x: indexTip.x,
      y: indexTip.y,
    }
  }

  close() {
    this.landmarker?.close()
    this.landmarker = null
  }
}