import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame, BROWSER_BAR_HEIGHT } from "../components/BrowserFrame";
import { Caption } from "../components/Caption";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import type { SceneSfx } from "../components/SoundTrack";
import { ShotCamera } from "../components/ShotCamera";
import { Tap } from "../components/Tap";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly question: string;
  readonly caption: string;
  readonly captionHighlight: readonly string[];
  readonly chapter: Chapter;
};

const FRAME_W = 1560;
const FRAME_H = 800;
const VIEW_H = FRAME_H - BROWSER_BAR_HEIGHT;
// admin-ask.png is 3200 x 5274 (DPR 2): the real answer to "من أجاب بثقة وكان مخطئاً؟".
const FIT = FRAME_W / 3200;
const TYPE_START = 34;
const TYPE_END = 74;
const ASK_TAP = 84;
const ANSWER_IN = 92;

/** Sound effects, in frames from the scene start. */
export const READINESS_SFX: readonly SceneSfx[] = [
  ...[0, 1, 2, 3].map(
    (i: number): SceneSfx => ({
      at: TYPE_START + 2 + i * 10,
      sound: "mouse-click",
      volume: 0.25,
    }),
  ),
  { at: ASK_TAP, sound: "mouse-click", volume: 0.6 },
  { at: ANSWER_IN + 2, sound: "switch", volume: 0.45 },
  { at: 128, sound: "ding", volume: 0.25 },
];

/** Chapter 4: an Arabic question becomes read-only SQL and names the confident-but-wrong learners. */
export const Readiness: React.FC<Props> = ({
  question,
  caption,
  captionHighlight,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 28);
  const typed = progress(frame, TYPE_START, TYPE_END - TYPE_START);
  const answer = progress(frame, ANSWER_IN, 18);
  const sqlGlow = progress(frame, 128, 18);
  const words: readonly string[] = question.split(" ");
  const shownWords: number = Math.round(typed * words.length);
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
            src="shots/admin-ask.png"
            imageWidth={3200}
            imageHeight={5274}
            viewportWidth={FRAME_W}
            viewportHeight={VIEW_H}
            keys={[
              { frame: 0, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
              { frame: 30, cx: 1600, cy: 660, scale: 0.6 },
              { frame: ANSWER_IN, cx: 1600, cy: 660, scale: 0.6 },
              { frame: ANSWER_IN + 30, cx: 1600, cy: 950, scale: 0.6 },
            ]}
          >
            {/* replace the input's text with the question being typed */}
            <div
              style={{
                position: "absolute",
                left: 640,
                top: 590,
                width: 2100,
                height: 72,
                backgroundColor: "#FFF8E1",
              }}
            />
            <div
              dir="rtl"
              lang="ar"
              style={{
                position: "absolute",
                right: 3200 - 2734,
                top: 586,
                height: 80,
                display: "flex",
                alignItems: "center",
                fontFamily: FONTS.arabic,
                fontSize: 38,
                color: "#2B140A",
              }}
            >
              {words.slice(0, shownWords).join(" ")}
              <span
                style={{
                  display: "inline-block",
                  width: 3,
                  height: 44,
                  marginRight: 4,
                  backgroundColor: COLORS.brown,
                  opacity:
                    frame < ASK_TAP && Math.floor(frame / 8) % 2 === 0 ? 1 : 0,
                }}
              />
            </div>
            {/* answer area stays hidden until the question is asked */}
            <div
              style={{
                position: "absolute",
                left: 420,
                top: 740,
                width: 2380,
                height: 480,
                backgroundColor: "#FFFFFF",
                opacity: 1 - answer,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 430,
                top: 1118,
                width: 2340,
                height: 90,
                borderRadius: 22,
                boxShadow: `0 0 0 6px ${COLORS.yellow}, 0 0 70px rgba(255,215,0,0.6)`,
                opacity: sqlGlow,
              }}
            />
            <Tap x={512} y={622} atFrame={ASK_TAP} />
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
