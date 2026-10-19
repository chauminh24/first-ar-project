import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Hand, RotateCcw } from "lucide-react";

import { HandTracker } from "./HandTracker";
import { LiquidScene } from "./LiquidScene";
import { BLOB_PALETTES, type BlobPalette, type HandFrame, type InteractionMode } from "./types";

type Props = {
  onBack: () => void;
};

type CameraStatus = "prompt" | "requesting" | "denied" | "error" | "ready";

const SUMMON_DURATION_MS = 5000;

export default function LiquidPlayground({ onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const handRef = useRef<HandFrame>([]);
  const animationFrameRef = useRef(0);
  const mountedRef = useRef(true);
  const requestInProgressRef = useRef(false);
  const bothHandsSeenSinceRef = useRef<number | null>(null);
  const blobActiveRef = useRef(false);
  const summonProgressRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("prompt");
  const [handCount, setHandCount] = useState(0);
  const [pinching, setPinching] = useState(false);
  const [mode, setMode] = useState<InteractionMode>("idle");
  const [blobPalette, setBlobPalette] = useState<BlobPalette>("blue");
  const [blobActive, setBlobActive] = useState(false);
  const [summonProgress, setSummonProgress] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(animationFrameRef.current);
      trackerRef.current?.close();
      trackerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function requestCamera() {
    if (requestInProgressRef.current || cameraStatus === "ready") return;

    requestInProgressRef.current = true;
    setCameraStatus("requesting");

    let abandonCameraStream = false;
    const acquiredStream: { current: MediaStream | null } = { current: null };

    try {
      const cameraRequest = navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        })
        .then((stream) => {
          acquiredStream.current = stream;
          if (abandonCameraStream || !mountedRef.current) {
            stream.getTracks().forEach((track) => track.stop());
          }
          return stream;
        });

      const tracker = new HandTracker();
      trackerRef.current = tracker;

      const [stream] = await Promise.all([cameraRequest, tracker.initialize()]);

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        tracker.close();
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Camera video is unavailable.");

      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current) return;

      setCameraStatus("ready");

      let lastVideoTime = -1;
      let lastUiUpdate = 0;

      function loop() {
        if (!mountedRef.current || !trackerRef.current) return;

        const currentVideo = videoRef.current;
        const now = performance.now();

        if (
          currentVideo &&
          currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          currentVideo.currentTime !== lastVideoTime
        ) {
          lastVideoTime = currentVideo.currentTime;
          const hands = trackerRef.current.detect(currentVideo);
          handRef.current = hands;

          if (hands.length >= 2) {
            if (bothHandsSeenSinceRef.current === null) {
              bothHandsSeenSinceRef.current = now;
            }

            const elapsed = now - bothHandsSeenSinceRef.current;
            const progress = Math.min(1, elapsed / SUMMON_DURATION_MS);

            if (!blobActiveRef.current) {
              summonProgressRef.current = progress;
              setSummonProgress(progress);

              if (elapsed >= SUMMON_DURATION_MS) {
                blobActiveRef.current = true;
                setBlobActive(true);
              }
            }
          } else if (!blobActiveRef.current) {
            bothHandsSeenSinceRef.current = null;
            summonProgressRef.current = 0;
            setSummonProgress(0);
          }

          if (now - lastUiUpdate > 100) {
            setHandCount(hands.length);
            setPinching(hands.some((hand) => hand.isPinching));
            lastUiUpdate = now;
          }
        }

        animationFrameRef.current = requestAnimationFrame(loop);
      }

      loop();
    } catch (error) {
      console.error("Camera / tracking error:", error);

      abandonCameraStream = true;
      acquiredStream.current?.getTracks().forEach((track) => track.stop());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      trackerRef.current?.close();
      trackerRef.current = null;

      if (mountedRef.current) {
        setCameraStatus(
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
            ? "denied"
            : "error"
        );
      }
    } finally {
      requestInProgressRef.current = false;
    }
  }

  function resetScene() {
    bothHandsSeenSinceRef.current = handCount >= 2 ? performance.now() : null;
    blobActiveRef.current = false;
    summonProgressRef.current = 0;
    setBlobActive(false);
    setSummonProgress(0);
    setMode("idle");
    setResetVersion((version) => version + 1);
  }

  const progressPercent = Math.round(summonProgress * 100);

  return (
    <main className="fixed inset-0 isolate overflow-hidden bg-black text-white">
      <div className="absolute inset-0 z-0">
        <LiquidScene
          handRef={handRef}
          blobActive={blobActive}
          blobPalette={blobPalette}
          resetVersion={resetVersion}
          summonProgressRef={summonProgressRef}
          onModeChange={setMode}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(0,0,0,0.45)_100%)]" />

      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between p-5 sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-5 py-3 text-sm text-white backdrop-blur-xl transition-all duration-300 hover:-translate-x-1 hover:border-white/30"
        >
          <ArrowLeft size={16} />
          Repository
        </button>

        <div className="hidden text-right sm:block">
          <p className="text-[10px] tracking-[0.3em] text-white/40">EXPERIMENT 02</p>
          <h1 className="mt-1 text-sm font-medium tracking-wide text-white/80">
            Liquid Playground
          </h1>
        </div>
      </header>

      <aside className="absolute right-5 top-20 z-20 w-32 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-1.5 shadow-2xl backdrop-blur-xl sm:right-6 sm:top-24 sm:w-44">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-zinc-900">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full scale-x-[-1] object-cover"
          />
          {cameraStatus !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
              <Camera size={20} strokeWidth={1.5} />
              <span className="text-[9px] tracking-widest">CAMERA OFF</span>
            </div>
          )}
          {cameraStatus === "ready" && (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-2 py-1 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[8px] tracking-widest text-white/80">LIVE</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-1 pt-2 pb-0.5">
          <span className="text-[9px] tracking-widest text-white/40">HANDS DETECTED</span>
          <span className={`text-[10px] tabular-nums ${handCount >= 2 ? "text-emerald-300" : "text-white/40"}`}>
            {handCount}/2
          </span>
        </div>
      </aside>

      <div className="pointer-events-none absolute left-5 top-24 z-20 max-w-[55%] sm:left-8 sm:top-28 sm:max-w-xs">
        <p className="text-[9px] tracking-[0.3em] text-white/35 sm:text-[10px]">
          INTERACTIVE STUDY
        </p>
        <h2 className="mt-3 text-xl font-light tracking-tight text-white/90 sm:text-3xl">
          Hold the space.
          <br />
          <span className="text-white/40">Shape the liquid.</span>
        </h2>
        <p className="mt-3 hidden max-w-[230px] text-xs leading-relaxed text-white/40 sm:block">
          Hold both hands in view for five seconds. The liquid forms between
          your palms and stays right where it was born. Pinch it with either
          hand and pull, push or drag: move your hand toward the camera to pull
          it out in depth. Use both hands to stretch it like clay. Pinch empty
          space to spin it.
        </p>
        {cameraStatus === "ready" && (
          <div className="pointer-events-auto mt-5 flex w-fit flex-col gap-1.5 rounded-2xl border border-white/10 bg-black/50 p-2.5 shadow-xl backdrop-blur-xl">
            {Object.entries(BLOB_PALETTES).map(([palette, colors]) => (
              <button
                key={palette}
                type="button"
                onClick={() => setBlobPalette(palette as BlobPalette)}
                aria-label={`Use ${colors.label} blob color`}
                aria-pressed={blobPalette === palette}
                title={colors.label}
                className={`flex items-center gap-2 rounded-full px-2 py-1.5 text-[10px] text-white/80 transition-colors hover:bg-white/10 ${blobPalette === palette ? "bg-white/10" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-8 w-8 rounded-full ${blobPalette === palette ? "ring-2 ring-white ring-offset-2 ring-offset-black" : ""}`}
                  style={{ backgroundColor: colors.color }}
                />
                
              </button>
            ))}
          </div>
        )}
      </div>

      {cameraStatus === "ready" && handCount >= 2 && !blobActive && (
        <div className="fixed left-1/2 top-1/2 z-30 w-56 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/45 p-4 text-center backdrop-blur-xl sm:w-64">
          <p className="text-[10px] tracking-[0.2em] text-cyan-100/70">
            MATERIALIZING BETWEEN HANDS
          </p>
          <p className="mt-2 text-2xl font-light tabular-nums">
            {(5 - summonProgress * 5).toFixed(1)}
            <span className="ml-1 text-sm text-white/40">s</span>
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-200 transition-[width] duration-100"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {cameraStatus === "ready" && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-white/10 bg-black/50 px-5 py-3 text-[10px] tracking-[0.18em] text-white/80 shadow-xl backdrop-blur-xl">
          <span className={`h-1.5 w-1.5 rounded-full ${mode === "sculpt" ? "bg-cyan-200" : mode === "rotate" ? "bg-amber-300" : handCount < 1 || (!blobActive && handCount < 2) ? "bg-white/30" : blobActive ? "bg-cyan-200/60" : "bg-emerald-400"}`} />
          {!blobActive
            ? handCount < 2
              ? "SHOW BOTH HANDS"
              : "HOLD BOTH HANDS TO SUMMON"
            : handCount < 1
              ? "SHOW A HAND"
              : mode === "sculpt"
                ? "SCULPTING"
                : mode === "rotate"
                  ? "SPINNING"
                  : pinching
                    ? "PINCH ON THE LIQUID TO SHAPE IT"
                    : "PINCH THE LIQUID TO SHAPE IT"}
        </div>
      )}

      {cameraStatus === "ready" && (
        <button
          type="button"
          onClick={resetScene}
          title="Reset and summon again"
          className="fixed bottom-6 right-5 z-30 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-black/45 px-4 py-3 text-xs text-white/80 backdrop-blur-xl transition-all hover:border-white/30 hover:bg-white/10 sm:right-6"
        >
          <RotateCcw size={14} />
          <span className="hidden sm:inline">Reset</span>
        </button>
      )}

      {cameraStatus !== "ready" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-5 backdrop-blur-md">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-dialog-title"
            className="w-full max-w-md rounded-3xl border border-white/15 bg-zinc-950 p-7 text-center shadow-2xl sm:p-8"
          >
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-pink-400/15 text-pink-300">
              {cameraStatus === "requesting" ? <Hand size={26} aria-hidden="true" /> : <Camera size={26} aria-hidden="true" />}
            </div>
            <p className="mb-2 text-[10px] tracking-[0.25em] text-pink-300/80">
              INTERACTIVE EXPERIMENT
            </p>
            <h1 id="camera-dialog-title" className="text-xl font-medium text-white">
              {cameraStatus === "denied"
                ? "Camera access was blocked"
                : cameraStatus === "error"
                  ? "Could not start the camera"
                  : cameraStatus === "requesting"
                    ? "Waiting for permission"
                    : "Enter the liquid space"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {cameraStatus === "denied"
                ? "Allow camera access in your browser’s site settings, then try again."
                : cameraStatus === "error"
                  ? "Check that your camera is connected and available, then try again."
                  : cameraStatus === "requesting"
                    ? "Choose Allow in your browser’s camera permission prompt."
                    : "Use both hands to summon and reshape a real-time 3D liquid object. Your camera feed stays in your browser."}
            </p>
            <button
              type="button"
              onClick={() => void requestCamera()}
              disabled={cameraStatus === "requesting"}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-pink-400 px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-pink-300 disabled:cursor-wait disabled:opacity-60"
            >
              <Camera size={16} aria-hidden="true" />
              {cameraStatus === "requesting"
                ? "Waiting for permission…"
                : cameraStatus === "denied" || cameraStatus === "error"
                  ? "Try again"
                  : "Allow camera"}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="mt-4 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              Go back
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
