import LandingPage from "./LandingPage";
import WaterRipplePage from "./pj01/WaterRipplePage";

export default function App() {
  const path =
    window.location.pathname;

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