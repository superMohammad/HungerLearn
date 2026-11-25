import type React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS, progress } from "../theme";

type Props = {
  readonly x: number;
  readonly y: number;
  readonly atFrame: number;
};

/** Finger-tap ripple at (x, y) that fires at `atFrame`. */
export const Tap: React.FC<Props> = ({ x, y, atFrame }) => {
  const frame = useCurrentFrame();
  if (frame < atFrame - 8 || frame > atFrame + 24) return null;
  const press = progress(frame, atFrame - 8, 8);
  const ring = progress(frame, atFrame, 22);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -34,
          top: -34,
          width: 68,
          height: 68,
          borderRadius: 34,
          backgroundColor: "rgba(71,28,9,0.35)",
          transform: `scale(${0.6 + press * 0.4 - ring * 0.3})`,
          opacity: 1 - ring,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -34,
          top: -34,
          width: 68,
          height: 68,
          borderRadius: 34,
          border: `4px solid ${COLORS.yellow}`,
          transform: `scale(${1 + ring * 1.6})`,
          opacity: (1 - ring) * press,
        }}
      />
    </div>
  );
};
