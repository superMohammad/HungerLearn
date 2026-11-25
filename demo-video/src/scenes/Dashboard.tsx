import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame, BROWSER_BAR_HEIGHT } from "../components/BrowserFrame";
import { Caption } from "../components/Caption";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import { ShotCamera } from "../components/ShotCamera";
import type { SceneSfx } from "../components/SoundTrack";
import { COLORS, progress } from "../theme";

type Props = {
  readonly caption: string;
  readonly captionHighlight: readonly string[];
  readonly chapter: Chapter;
};

const FRAME_W = 1560;
const FRAME_H = 800;
const VIEW_H = FRAME_H - BROWSER_BAR_HEIGHT;
// admin-readiness.png is 3200 x 4824 (DPR 2).
const FIT = FRAME_W / 3200;
const BAR_GLOW = 62;
const BADGE_GLOW = 128;

/** Sound effects, in frames from the scene start. */
export const DASHBOARD_SFX: readonly SceneSfx[] = [
  { at: BAR_GLOW, sound: "switch", volume: 0.45 },
  { at: BADGE_GLOW, sound: "ding", volume: 0.3 },
];

/** Supervisor dashboard: pass rate per procedure and branch, then the confident-but-wrong flag. */
export const Dashboard: React.FC<Props> = ({
  caption,
  captionHighlight,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 28);
  const bar = progress(frame, BAR_GLOW, 14) * (1 - progress(frame, 96, 12));
  const badge = progress(frame, BADGE_GLOW, 14);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: (1920 - FRAME_W) / 2,
          top: 150,
          opacity: enter,
          transform: `perspective(2200px) rotateX(${(1 - enter) * 16}deg) translateY(${(1 - enter) * 100}px)`,
        }}
      >
        <BrowserFrame
          width={FRAME_W}
          height={FRAME_H}
          url="hungerlearn.app/admin/readiness"
        >
          <ShotCamera
            src="shots/admin-readiness.png"
            imageWidth={3200}
            imageHeight={4824}
            viewportWidth={FRAME_W}
            viewportHeight={VIEW_H}
            keys={[
              { frame: 0, cx: 1600, cy: 1500, scale: FIT },
              { frame: 40, cx: 1700, cy: 2000, scale: 0.55 },
              { frame: 100, cx: 1700, cy: 2000, scale: 0.55 },
              { frame: 128, cx: 1500, cy: 3150, scale: 0.72 },
            ]}
          >
            {/* "تأخر تجهيز الطلب" 33% row, then the "أخطأ وهو واثق ×1" badge */}
            <div
              style={{
                position: "absolute",
                left: 1650,
                top: 1680,
                width: 1150,
                height: 150,
                borderRadius: 24,
                boxShadow: `0 0 0 7px ${COLORS.yellow}, 0 0 80px rgba(255,215,0,0.6)`,
                opacity: bar,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 822,
                top: 3068,
                width: 290,
                height: 70,
                borderRadius: 35,
                boxShadow: `0 0 0 7px ${COLORS.yellow}, 0 0 80px rgba(255,215,0,0.7)`,
                opacity: badge,
                transform: `scale(${1.15 - badge * 0.15})`,
              }}
            />
          </ShotCamera>
        </BrowserFrame>
      </div>
      <ChapterChip index={chapter.index} label={chapter.label} />
      {frame >= 112 ? (
        <div
          style={{ position: "absolute", left: 120, right: 120, bottom: 46 }}
        >
          <Caption
            text={caption}
            highlight={captionHighlight}
            startFrame={112}
            fontSize={54}
            align="center"
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
