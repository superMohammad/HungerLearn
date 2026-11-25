import { loadFont as loadArabic } from "@remotion/google-fonts/IBMPlexSansArabic";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadNaskh } from "@remotion/google-fonts/NotoNaskhArabic";
import { Easing, interpolate } from "remotion";

/** Brand palette (HungerStation-derived, matches web/ tokens). */
export const COLORS = {
  ink: "#1E0B04",
  deep: "#2A1208",
  brown: "#5E2D20",
  brownDeep: "#471C09",
  yellow: "#FFD700",
  cream: "#FFF7E0",
  creamSoft: "#F5E9C8",
  muted: "rgba(255, 247, 224, 0.55)",
  line: "rgba(255, 247, 224, 0.14)",
} as const;

export const FONTS = {
  arabic: loadArabic("normal", {
    weights: ["400", "500", "700"],
    subsets: ["arabic", "latin"],
  }).fontFamily,
  mono: loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] })
    .fontFamily,
  naskh: loadNaskh("normal", { weights: ["400", "700"], subsets: ["arabic"] })
    .fontFamily,
} as const;

/** The single easing curve used for every move in the video. */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

/** Eased 0..1 progress of a move that starts at `start` and lasts `duration` frames. */
export const progress = (
  frame: number,
  start: number,
  duration: number,
): number =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

/** Same as `progress` but symmetric ease-in-out, for camera travel. */
export const travel = (
  frame: number,
  start: number,
  duration: number,
): number =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });

export const mix = (from: number, to: number, t: number): number =>
  from + (to - from) * t;
