import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame, BROWSER_BAR_HEIGHT } from "../components/BrowserFrame";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import type { SceneSfx } from "../components/SoundTrack";
import { ShotCamera } from "../components/ShotCamera";
import { Tap } from "../components/Tap";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly checks: readonly string[];
  readonly publishedLabel: string;
  readonly chapter: Chapter;
};

const FRAME_W = 1240;
const FRAME_H = 820;
const VIEW_H = FRAME_H - BROWSER_BAR_HEIGHT;
const FRAME_LEFT = 600;
const FRAME_TOP = 170;
// admin-review.png is 3200 x 3572 (DPR 2).
const FIT = FRAME_W / 3200;
const CHECK_START = 40;
const CHECK_GAP = 22;
const APPROVE_TAP = 146;

const Check: React.FC<{ readonly label: string; readonly at: number }> = ({
  label,
  at,
}) => {
  const frame = useCurrentFrame();
  const t = progress(frame, at, 20);
  const tick = progress(frame, at + 8, 14);
  return (
    <div
      dir="rtl"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "22px 26px",
        borderRadius: 22,
        backgroundColor: "rgba(255,247,224,0.06)",
        border: `1px solid ${COLORS.line}`,
        opacity: t,
        transform: `translateX(${(1 - t) * -60}px)`,
      }}
    >
      <svg width={44} height={44} viewBox="0 0 44 44">
        <circle
          cx={22}
          cy={22}
          r={20}
          fill={COLORS.yellow}
          opacity={0.15 + tick * 0.85}
        />
        <path
          d="M13 23 L19.5 29.5 L31 16"
          fill="none"
          stroke={COLORS.ink}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={30}
          strokeDashoffset={30 * (1 - tick)}
        />
      </svg>
      <span
        style={{
          fontFamily: FONTS.arabic,
          fontWeight: 500,
          fontSize: 29,
          color: COLORS.cream,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
};

/** Sound effects, in frames from the scene start. */
export const GENERATE_SFX: readonly SceneSfx[] = [
  ...[0, 1, 2].map(
    (i: number): SceneSfx => ({
      at: CHECK_START + 8 + i * CHECK_GAP,
      sound: "switch",
      volume: 0.5,
    }),
  ),
  { at: APPROVE_TAP, sound: "mouse-click", volume: 0.6 },
  { at: APPROVE_TAP + 6, sound: "shutter-modern", volume: 0.45 },
];

/** Chapter 2: the training package is generated, auto-verified, then approved by a human. */
export const Generate: React.FC<Props> = ({
  checks,
  publishedLabel,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 30);
  const stamp = progress(frame, APPROVE_TAP + 6, 18);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: FRAME_LEFT,
          top: FRAME_TOP,
          opacity: enter,
          transform: `perspective(2200px) rotateY(${(1 - enter) * -18}deg) translateX(${(1 - enter) * 120}px)`,
        }}
      >
        <BrowserFrame
          width={FRAME_W}
          height={FRAME_H}
          url="hungerlearn.app/admin/review"
        >
          <ShotCamera
            src="shots/admin-review.png"
            imageWidth={3200}
            imageHeight={3572}
            viewportWidth={FRAME_W}
            viewportHeight={VIEW_H}
            keys={[
              { frame: 0, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
              { frame: 24, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
              { frame: 70, cx: 1180, cy: 900, scale: 0.52 },
              { frame: 112, cx: 1180, cy: 950, scale: 0.52 },
              { frame: 140, cx: 1300, cy: 3040, scale: 0.8 },
            ]}
          >
            {/* "اعتماد هذا العنصر" button centre in screenshot pixels */}
            <Tap x={1582} y={3154} atFrame={APPROVE_TAP} />
          </ShotCamera>
          {stamp > 0 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `rgba(30,11,4,${stamp * 0.35})`,
              }}
            >
              <div
                dir="rtl"
                style={{
                  fontFamily: FONTS.arabic,
                  fontWeight: 700,
                  fontSize: 58,
                  color: COLORS.ink,
                  backgroundColor: COLORS.yellow,
                  padding: "22px 54px",
                  borderRadius: 999,
                  transform: `scale(${1.4 - stamp * 0.4}) rotate(${-4 * stamp}deg)`,
                  opacity: stamp,
                  boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
                }}
              >
                {publishedLabel}
              </div>
            </div>
          ) : null}
        </BrowserFrame>
      </div>
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 300,
          width: 500,
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        {checks.map((label, i) => (
          <Check key={label} label={label} at={CHECK_START + i * CHECK_GAP} />
        ))}
      </div>
      <ChapterChip index={chapter.index} label={chapter.label} />
    </AbsoluteFill>
  );
};
