import {
    useEffect,
    useRef,
    useState,
} from "react";

import { ArrowLeft, Camera } from "lucide-react";

import "./waterRipple.css";

import { HandTracker } from "./handTracker";
import { WaterRipple } from "./waterRipple";

type Props = {
    onBack: () => void;
};

export default function WaterRipplePage({
    onBack,
}: Props) {
    const videoRef =
        useRef<HTMLVideoElement>(null);

    const canvasRef =
        useRef<HTMLCanvasElement>(null);

    const streamRef =
        useRef<MediaStream | null>(null);

    const trackerRef =
        useRef<HandTracker | null>(null);

    const rippleRef =
        useRef<WaterRipple | null>(null);

    const animationFrameRef =
        useRef(0);

    const mountedRef =
        useRef(true);

    const cameraRequestInProgressRef =
        useRef(false);

    const [cameraStatus, setCameraStatus] =
        useState<"prompt" | "requesting" | "denied" | "error" | "ready">("prompt");

    const [openPalm, setOpenPalm] =
        useState(false);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;

            cancelAnimationFrame(
                animationFrameRef.current
            );

            trackerRef.current?.close();
            rippleRef.current?.destroy();

            streamRef.current
                ?.getTracks()
                .forEach((track) => {
                    track.stop();
                });
        };
    }, []);

    async function requestCamera() {
        if (
            cameraRequestInProgressRef.current ||
            cameraStatus === "ready"
        ) {
            return;
        }

        cameraRequestInProgressRef.current = true;
        setCameraStatus("requesting");

        let lastRippleTime = 0;
        let lastX = 0.5;
        let lastY = 0.5;

        try {
            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: "user",

                        width: {
                            ideal: 1280,
                        },

                        height: {
                            ideal: 720,
                        },

                        frameRate: {
                            ideal: 60,
                            max: 60,
                        },
                    },

                    audio: false,
                });

            if (!mountedRef.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            streamRef.current = stream;

            const video = videoRef.current;
            const canvas = canvasRef.current;

            if (!video || !canvas) {
                throw new Error("Camera video or ripple canvas is unavailable.");
            }

            video.srcObject = stream;
            await video.play();

            if (!mountedRef.current) {
                return;
            }

            const tracker = new HandTracker();
            trackerRef.current = tracker;
            await tracker.initialize();

            if (!mountedRef.current) {
                return;
            }

            const ripple = new WaterRipple(canvas, video);
            rippleRef.current = ripple;
            setCameraStatus("ready");

            function loop() {
                if (!trackerRef.current || !rippleRef.current) {
                    return;
                }

                const currentVideo = videoRef.current;

                if (!currentVideo) {
                    return;
                }

                const finger = tracker.detect(currentVideo);

                if (finger) {
                    setOpenPalm(true);

                    const x = 1 - finger.x;
                    const y = 1 - finger.y;
                    const now = performance.now();
                    const distance = Math.hypot(
                        x - lastX,
                        y - lastY
                    );

                    if (
                        now - lastRippleTime > 65 &&
                        distance > 0.0015
                    ) {
                        const strength = Math.min(
                            1,
                            0.20 + distance * 12
                        );

                        ripple.addRipple(x, y, strength);
                        lastRippleTime = now;
                        lastX = x;
                        lastY = y;
                    }
                } else {
                    setOpenPalm(false);
                }

                animationFrameRef.current =
                    requestAnimationFrame(loop);
            }

            loop();
        } catch (error) {
            console.error(
                "Camera / tracking error:",
                error
            );

            streamRef.current
                ?.getTracks()
                .forEach((track) => track.stop());
            streamRef.current = null;
            trackerRef.current?.close();
            trackerRef.current = null;
            rippleRef.current?.destroy();
            rippleRef.current = null;

            if (mountedRef.current) {
                setCameraStatus(
                    error instanceof DOMException &&
                    (error.name === "NotAllowedError" ||
                        error.name === "PermissionDeniedError")
                        ? "denied"
                        : "error"
                );
            }
        } finally {
            cameraRequestInProgressRef.current = false;
        }
    }

    return (
        <main className="water-page">

            {/* =====================================
                CAMERA SOURCE

                This video is ONLY used as the
                WebGL texture source.

                It must NOT be visible.
            ===================================== */}

            <video
                ref={videoRef}
                className="camera-source"
                autoPlay
                playsInline
                muted
            />

            {/* =====================================
                WEBGL CAMERA

                This is the ONLY visible camera.
                The webcam image is rendered here
                with the water distortion.
            ===================================== */}

            <canvas
                ref={canvasRef}
                className="water"
            />

            {/* =====================================
                BACK BUTTON
            ===================================== */}

            <button
                onClick={onBack}
                className="
                    fixed
                    left-6
                    top-6
                    z-50

                    flex
                    items-center
                    gap-2

                    rounded-full

                    border
                    border-white/10

                    bg-black/40

                    px-5
                    py-3

                    text-sm
                    text-white

                    backdrop-blur-xl

                    transition-all
                    duration-300

                    hover:-translate-x-1
                    hover:border-white/30
                "
            >
                <ArrowLeft size={16} />

                Repository
            </button>

            {/* =====================================
                STATUS
            ===================================== */}

            {cameraStatus === "ready" && (
                <div
                    className="
                        fixed
                        bottom-6
                        left-1/2
                        z-50
                        -translate-x-1/2
                        rounded-full
                        border
                        border-white/10
                        bg-black/40
                        px-5
                        py-3
                        text-[10px]
                        tracking-[0.2em]
                        text-white
                        backdrop-blur-xl
                    "
                >
                    {openPalm ? "WATER ACTIVE" : "SHOW YOUR PALM"}
                </div>
            )}

            {cameraStatus !== "ready" && (
                <div
                    className="
                        fixed
                        inset-0
                        z-[100]
                        flex
                        items-center
                        justify-center
                        bg-black/70
                        px-5
                        backdrop-blur-md
                    "
                >
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="camera-dialog-title"
                        className="
                            w-full
                            max-w-md
                            rounded-3xl
                            border
                            border-white/15
                            bg-zinc-950
                            p-7
                            text-center
                            text-white
                            shadow-2xl
                        "
                    >
                        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-pink-400/15 text-pink-300">
                            <Camera size={26} aria-hidden="true" />
                        </div>
                        <h1
                            id="camera-dialog-title"
                            className="text-xl font-medium"
                        >
                            {cameraStatus === "denied"
                                ? "Camera access was blocked"
                                : cameraStatus === "error"
                                    ? "Could not start the camera"
                                    : "Camera access needed"}
                        </h1>
                        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                            {cameraStatus === "denied"
                                ? "Allow camera access in your browser’s site settings, then try again."
                                : cameraStatus === "error"
                                    ? "Check that your camera is connected and available, then try again."
                                    : cameraStatus === "requesting"
                                        ? "Waiting for camera permission. Choose Allow in your browser’s prompt."
                                        : "Allow camera access to use hand tracking and the water ripple effect. Your camera feed stays in your browser."}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                void requestCamera();
                            }}
                            disabled={cameraStatus === "requesting"}
                            className="
                                mt-6
                                inline-flex
                                w-full
                                items-center
                                justify-center
                                gap-2
                                rounded-full
                                bg-pink-400
                                px-5
                                py-3
                                text-sm
                                font-medium
                                text-black
                                transition-colors
                                hover:bg-pink-300
                                disabled:cursor-wait
                                disabled:opacity-60
                            "
                        >
                            <Camera size={16} aria-hidden="true" />
                            {cameraStatus === "requesting"
                                ? "Waiting for permission…"
                                : cameraStatus === "denied" ||
                                    cameraStatus === "error"
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