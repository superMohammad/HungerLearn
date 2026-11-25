import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import { PhoneShot } from "../components/PhoneShot";
import type { SceneSfx } from "../components/SoundTrack";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly title: string;
  readonly body: string;
  readonly chapter: Chapter;
};

const LEVEL_POP = 30;
const BADGE_POP = 46;
const PASSED_POP = 62;

/** Sound effects, in frames from the scene start. */
export const PROGRESS_SFX: readonly SceneSfx[] = [
  { at: LEVEL_POP, sound: "switch", volume: 0.45 },
  { at: BADGE_POP, sound: "switch", volume: 0.45 },
  { at: PASSED_POP, sound: "ding", volume: 0.3 },
];

/** Glow ring around a screenshot box (screenshot pixels) that pops in at `at`. */
const Ring: React.FC<{
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly at: number;
}> = ({ left, top, width, height, radius, at }) => {
  const frame = useCurrentFrame();
  const t = progress(frame, at, 14);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: radius,
        boxShadow: `0 0 0 10px ${COLORS.yellow}, 0 0 90px rgba(255,215,0,0.7)`,
        opacity: t,
        transform: `scale(${1.08 - t * 0.08})`,
      }}
    />
  );
};

/** The learner's level and badges (learn-home.png, 1170 x 2532). */
export const Progress: React.FC<Props> = ({ title, body, chapter }) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 26);
  const t = progress(frame, 10, 24);
  const b = progress(frame, 18, 24);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: 250,
          top: (1080 - 912) / 2,
          opacity: enter,
          transform: `perspective(2000px) translateY(${(1 - enter) * 120}px) rotateY(8deg)`,
        }}
      >
        <PhoneShot src="shots/learn-home.png" imageHeight={2532}>
          {/* level card, badges card, and the "اجتاز" pill */}
          <Ring
            left={610}
            top={810}
            width={512}
            height={306}
            radius={70}
            at={LEVEL_POP}
          />
          <Ring
            left={50}
            top={810}
            width={510}
            height={306}
            radius={70}
            at={BADGE_POP}
          />
          <Ring
            left={110}
            top={1416}
            width={196}
            height={72}
            radius={36}
            at={PASSED_POP}
          />
        </PhoneShot>
      </div>
      <div
        dir="rtl"
        lang="ar"
        style={{
          position: "absolute",
          right: 150,
          top: 380,
          width: 900,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.arabic,
            fontWeight: 700,
            fontSize: 82,
            lineHeight: 1.25,
            color: COLORS.cream,
            opacity: t,
            transform: `translateY(${(1 - t) * 30}px)`,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: FONTS.arabic,
            fontSize: 40,
            lineHeight: 1.5,
            color: COLORS.muted,
            opacity: b,
            transform: `translateY(${(1 - b) * 30}px)`,
          }}
        >
          {body}
        </div>
      </div>
      <ChapterChip index={chapter.index} label={chapter.label} />
    </AbsoluteFill>
  );
};
