// Whether live answers are switched on (GET /api/status), asked once per page load and shared
// by every part that needs it (the desk's tabs, the nav button, the hero's words).

import { useEffect, useState } from "react";

let status: Promise<boolean> | null = null;

function liveStatus(): Promise<boolean> {
  status ??= fetch("/api/status")
    .then((r) => (r.ok ? r.json() : { live: false }))
    .then((s: { live?: boolean }) => s.live === true)
    .catch(() => false);
  return status;
}

/** null until the page knows. */
export function useLive(): boolean | null {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    liveStatus().then((v) => on && setLive(v));
    return () => {
      on = false;
    };
  }, []);
  return live;
}

const reduce = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** false when the visitor asked for reduced motion: animations then show their last frame. */
export function useMotion(): boolean {
  const [motion, setMotion] = useState(() => !reduce());
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setMotion(!q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return motion;
}

/** Bring the desk into view and, when the chat is there, put the cursor in it. */
export function jumpToDesk(motion: boolean) {
  const desk = document.getElementById("desk");
  if (!desk) return;
  desk.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
  const box = desk.querySelector("textarea");
  if (box) box.focus({ preventScroll: true });
}
