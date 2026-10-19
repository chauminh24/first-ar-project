import { useEffect } from "react";
import LandingPage from "./LandingPage";
import WaterRipplePage from "./pj01/WaterRipplePage";
import LiquidPlayground from './pj02/LiquidPlayground';

export default function App() {
  const path =
    window.location.pathname;

  useEffect(() => {
    if (path !== "/" && path !== "/index.html") {
      return;
    }

    const loader = document.getElementById("initial-loader");

    if (!loader) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      loader.classList.add("hidden");
    });
    const timeout = window.setTimeout(() => {
      loader.remove();
    }, 500);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [path]);

  // ==========================================
  // WATER RIPPLE
  // ==========================================

  if (
    path === "/water-ripple" ||
    path === "/water-ripple/"
  ) {
    return (
      <WaterRipplePage
        onBack={() => {
          window.history.pushState(
            {},
            "",
            "/"
          );

          window.location.reload();
        }}
      />
    );
  }

  // ==========================================
  // LIQUID PLAYGROUND
  // ==========================================

  if (
    path === "/slimey-playground" ||
    path === "/slimey-playground/"
  ) {
    return (
      <LiquidPlayground
        onBack={() => {
          window.history.pushState(
            {},
            "",
            "/"
          );

          window.location.reload();
        }}
      />
    );
  }

  // ==========================================
  // LANDING
  // ==========================================

  return (
    <LandingPage
      onOpenProject={(projectPath) => {
        window.history.pushState(
          {},
          "",
          projectPath
        );

        window.location.reload();
      }}
    />
  );
}