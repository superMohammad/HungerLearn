import type React from "react";
import type { SceneSfx } from "../components/SoundTrack";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS, FONTS, progress } from "../theme";

type Node = { readonly title: string; readonly tech: string };

type Props = {
  readonly nodes: readonly Node[];
  readonly headline: string;
  readonly apiLine: string;
  readonly specs: string;
};

const NODE_W = 340;
const GAP = 70;

/** Sound effects, in frames from the scene start. */
export const LOCAL_STACK_SFX: readonly SceneSfx[] = [
  ...[0, 1, 2].map(
    (i: number): SceneSfx => ({ at: 4 + i * 10, sound: "switch", volume: 0.4 }),
  ),
  { at: 74, sound: "switch", volume: 0.5 },
];

/** The pipeline lights up node by node: it runs locally, or against any API provider. */
export const LocalStack: React.FC<Props> = ({
  nodes,
  headline,
  apiLine,
  specs,
}) => {
  const frame = useCurrentFrame();
  const total = nodes.length * NODE_W + (nodes.length - 1) * GAP;
  const left0 = (1920 - total) / 2;
  const head = progress(frame, 34, 22);
  const api = progress(frame, 72, 20);
  const spec = progress(frame, 84, 20);
  return (
    <AbsoluteFill>
      <Backdrop />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        {nodes.slice(1).map((n, i) => {
          // RTL: the first node sits on the right; connectors run right-to-left.
          const t = progress(frame, 10 + i * 10, 12);
          const xRight = 1920 - left0 - (i + 1) * NODE_W - i * GAP;
          return (
            <line
              key={n.title}
              x1={xRight}
              y1={380}
              x2={xRight - GAP * t}
              y2={380}
              stroke={COLORS.yellow}
              strokeWidth={4}
            />
          );
        })}
      </svg>
      {nodes.map((n, i) => {
        const t = progress(frame, i * 10, 16);
        return (
          <div
            key={n.title}
            dir="rtl"
            style={{
              position: "absolute",
              right: left0 + i * (NODE_W + GAP),
              top: 300,
              width: NODE_W,
              height: 160,
              borderRadius: 26,
              backgroundColor: "rgba(255,247,224,0.07)",
              border: `2px solid ${t > 0.6 ? COLORS.yellow : COLORS.line}`,
              boxShadow: `0 0 ${50 * t}px rgba(255,215,0,${0.25 * t})`,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: 10,
              opacity: t,
              transform: `translateY(${(1 - t) * 30}px)`,
            }}
          >
            <span
              style={{
                fontFamily: FONTS.arabic,
                fontWeight: 700,
                fontSize: 38,
                color: COLORS.cream,
              }}
            >
              {n.title}
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 21,
                color: COLORS.yellow,
              }}
            >
              {n.tech}
            </span>
          </div>
        );
      })}
      <div
        dir="rtl"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 540,
          textAlign: "center",
          fontFamily: FONTS.arabic,
          fontWeight: 700,
          fontSize: 92,
          color: COLORS.cream,
          opacity: head,
          transform: `translateY(${(1 - head) * 30}px)`,
        }}
      >
        {headline}
      </div>
      <div
        dir="rtl"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 690,
          textAlign: "center",
          fontFamily: FONTS.arabic,
          fontWeight: 700,
          fontSize: 66,
          opacity: api,
          transform: `translateY(${(1 - api) * 24}px)`,
          filter: `blur(${(1 - api) * 8}px)`,
        }}
      >
        {apiLine.split(" ").map((w, i) => (
          <span
            key={`${w}-${i}`}
            style={{ color: w === "API" ? COLORS.yellow : COLORS.cream }}
          >
            {w}{" "}
          </span>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 810,
          textAlign: "center",
          fontFamily: FONTS.mono,
          fontSize: 28,
          letterSpacing: 4,
          color: COLORS.yellow,
          opacity: spec * 0.85,
        }}
      >
        {specs}
      </div>
    </AbsoluteFill>
  );
};
