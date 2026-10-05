import {
    useEffect,
    useRef,
    useState,
} from "react";

import { ArrowLeft } from "lucide-react";

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

    const [loading, setLoading] =
        useState(true);

    const [openPalm, setOpenPalm] =
        useState(false);

    useEffect(() => {
        let stream:
            MediaStream | null = null;

        let tracker:
            HandTracker | null = null;

        let ripple:
            WaterRipple | null = null;

        let animationFrame = 0;

        let lastRippleTime = 0;

        let lastX = 0.5;
        let lastY = 0.5;

        async function start() {
            try {
                // =====================================
                // CAMERA
                // =====================================

                stream =
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

                const video =
                    videoRef.current;

                const canvas =
                    canvasRef.current;

                if (!video || !canvas) {
                    return;
                }

                video.srcObject = stream;

                await video.play();

                // =====================================
                // HAND TRACKING
                // =====================================

                tracker =
                    new HandTracker();

                await tracker.initialize();

                // =====================================
                // WATER
                // =====================================

                ripple =
                    new WaterRipple(
                        canvas,
                        video
                    );

                setLoading(false);

                // =====================================
                // LOOP
                // =====================================

                function loop() {
                    if (
                        !tracker ||
                        !ripple
                    ) {
                        return;
                    }
                    const video =
                        videoRef.current

                    if (!video) {
                        return
                    }

                    const finger =
                        tracker.detect(video);

                    if (finger) {
                        setOpenPalm(true);

                        /*
                         * Mirror X for selfie camera.
                         */

                        const x =
                            1 - finger.x;

                        /*
                         * Flip Y for WebGL.
                         */

                        const y =
                            1 - finger.y;

                        const now =
                            performance.now();

                        const distance =
                            Math.hypot(
                                x - lastX,
                                y - lastY
                            );

                        if (
                            now -
                            lastRippleTime >
                            65 &&
                            distance >
                            0.0015
                        ) {
                            const strength =
                                Math.min(
                                    1,
                                    0.20 +
                                    distance * 12
                                );

                            ripple.addRipple(
                                x,
                                y,
                                strength
                            );

                            lastRippleTime =
                                now;

                            lastX = x;
                            lastY = y;
                        }
                    } else {
                        setOpenPalm(false);
                    }

                    animationFrame =
                        requestAnimationFrame(loop);
                }

                loop();
            } catch (error) {
                console.error(
                    "Camera / tracking error:",
                    error
                );

                setLoading(false);
            }
        }

        start();

        return () => {
            cancelAnimationFrame(
                animationFrame
            );

            tracker?.close();

            ripple?.destroy();

            stream
                ?.getTracks()
                .forEach((track) => {
                    track.stop();
                });
        };
    }, []);

    return (
        <main className="water-page">

            {/* CAMERA SOURCE */}

            <video
                ref={videoRef}
                className="camera"
                autoPlay
                playsInline
                muted
            />

            {/* WEBGL */}

            <canvas
                ref={canvasRef}
                className="water"
            />

            {/* BACK */}

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

            {/* STATUS */}

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
                {loading
                    ? "INITIALIZING CAMERA"
                    : openPalm
                        ? "WATER ACTIVE"
                        : "SHOW YOUR PALM"}
            </div>

        </main>
    );
}