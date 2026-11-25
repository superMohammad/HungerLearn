import type React from "react";
import type { SceneSfx } from "../components/SoundTrack";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS, FONTS, progress } from "../theme";

export type Line = {
  readonly text: string;
  readonly highlight: readonly string[];
  readonly start: number;
  readonly end: number;
};

type Props = { readonly lines: readonly Line[] };

type Page = {
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly delay: number;
  readonly depth: number;
};

const PAGES: readonly Page[] = [
  { x: -620, y: -260, rot: -14, delay: 0, depth: 0.7 },
  { x: 640, y: -200, rot: 11, delay: 6, depth: 0.85 },
  { x: -700, y: 250, rot: 9, delay: 12, depth: 0.6 },
  { x: 700, y: 280, rot: -8, delay: 18, depth: 0.75 },
  { x: -260, y: -380, rot: 5, delay: 24, depth: 0.5 },
  { x: 300, y: 400, rot: -4, delay: 30, depth: 0.55 },
];

/** A stylised SOP page: header bar plus text lines. */
const SopPage: React.FC = () => (
  <div
    style={{
      width: 300,
      height: 400,
      backgroundColor: COLORS.creamSoft,
      borderRadius: 10,
      padding: 30,
      boxShadow: "0 30px 60px rgba(0,0,0,0.5)",
    }}
  >
    <div
      style={{
        height: 18,
        width: "60%",
        marginLeft: "auto",
        backgroundColor: COLORS.brown,
        borderRadius: 4,
        marginBottom: 26,
      }}
    />
    {Array.from({ length: 11 }, (_, i) => (
      <div
        key={i}
        style={{
          height: 9,
          width: `${92 - ((i * 37) % 30)}%`,
          marginLeft: "auto",
          backgroundColor: "rgba(94,45,32,0.28)",
          borderRadius: 4,
          marginBottom: 17,
        }}
      />
    ))}
  </div>
);

/** Sound effects, in frames from the scene start. */
export const problemSfx = (lines: readonly Line[]): readonly SceneSfx[] => [
  { at: 4, sound: "page-turn", volume: 0.5 },
  { at: 16, sound: "page-turn", volume: 0.4 },
  ...lines.map(
    (line: Line): SceneSfx => ({ at: line.start, sound: "whip", volume: 0.35 }),
  ),
];

/** The problem: manuals pile up, change, and nobody knows who is trained. */
export const Problem: React.FC<Props> = ({ lines }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          perspective: 1400,
        }}
      >
        {PAGES.map((p, i) => {
          const t = progress(frame, p.delay, 40);
          const drift = interpolate(frame, [0, 180], [0, 1]);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                opacity: t * p.depth * 0.9,
                transform: `translate(${p.x * (0.6 + 0.4 * t) + drift * p.x * 0.08}px, ${p.y * (0.6 + 0.4 * t)}px) rotate(${p.rot * t}deg) rotateY(${(1 - t) * 50}deg) scale(${0.55 + p.depth * 0.35})`,
                filter: `blur(${(1 - p.depth) * 6}px)`,
              }}
            >
              <SopPage />
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 45% 30% at 50% 50%, rgba(30,11,4,0.92), rgba(30,11,4,0) 100%)",
        }}
      />
      {lines.map((line) => {
        const inT = progress(frame, line.start, 18);
        const outT = progress(frame, line.end - 10, 10);
        if (frame < line.start || frame > line.end) return null;
        return (
          <AbsoluteFill
            key={line.text}
            style={{ alignItems: "center", justifyContent: "center" }}
          >
            <div
              dir="rtl"
              lang="ar"
              style={{
                fontFamily: FONTS.arabic,
                fontWeight: 700,
                fontSize: 96,
                color: COLORS.cream,
                textAlign: "center",
                maxWidth: 1500,
                lineHeight: 1.3,
                opacity: inT * (1 - outT),
                transform: `translateY(${(1 - inT) * 40 - outT * 30}px) scale(${0.96 + inT * 0.04})`,
                filter: `blur(${(1 - inT) * 12 + outT * 10}px)`,
              }}
            >
              {line.text.split(" ").map((w, i) => (
                <span
                  key={`${w}-${i}`}
                  style={{
                    color: line.highlight.includes(w)
                      ? COLORS.yellow
                      : COLORS.cream,
                  }}
                >
                  {w}{" "}
                </span>
              ))}
            </div>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
