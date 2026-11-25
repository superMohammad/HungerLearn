import { Video } from "@remotion/media";
import type React from "react";
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import type { SceneSfx } from "../components/SoundTrack";
import { PhoneFrame } from "../components/PhoneFrame";
import { ShotCamera } from "../components/ShotCamera";
import { Tap } from "../components/Tap";
import { COLORS, FONTS, progress } from "../theme";

type TextBlock = { readonly title: string; readonly body: string };

type Props = {
  readonly lessonText: TextBlock;
  readonly practiceText: TextBlock;
  readonly chapter: Chapter;
};

const SCREEN_W = 406;
const SCREEN_H = 880;
// Learner screenshots are 1170 px wide (390 css px at DPR 3).
const SCALE = SCREEN_W / 1170;
const STATUS_BAR = 44;
const CAMERA = [
  { frame: 0, cx: 585, cy: (SCREEN_H / 2 - STATUS_BAR) / SCALE, scale: SCALE },
] as const;
const LESSON_END = 150;
const QUESTION_LEN = 50;
const LESSON_CLIP_FRAMES = 141;

/** Correct answer and "متأكد" button boxes in screenshot pixels. */
type Question = {
  readonly src: string;
  readonly optionTop: number;
  readonly optionBottom: number;
  readonly sureTop: number;
  readonly sureBottom: number;
};

const QUESTIONS: readonly Question[] = [
  {
    src: "shots/learn-q-delay.png",
    optionTop: 1230,
    optionBottom: 1384,
    sureTop: 1730,
    sureBottom: 1870,
  },
  {
    src: "shots/learn-q-leave.png",
    optionTop: 1144,
    optionBottom: 1304,
    sureTop: 1644,
    sureBottom: 1786,
  },
  {
    src: "shots/learn-q-wrongbag.png",
    optionTop: 1224,
    optionBottom: 1388,
    sureTop: 1730,
    sureBottom: 1870,
  },
];

const OPTION_TAP = 12;
const SURE_TAP = 30;

/** One practice question: tap the right answer, then tap "متأكد". */
const QuestionScreen: React.FC<{ readonly q: Question }> = ({ q }) => {
  const frame = useCurrentFrame();
  const slide = progress(frame, 0, 12);
  const picked = progress(frame, OPTION_TAP, 6);
  const sure = progress(frame, SURE_TAP, 6);
  const optionMid = (q.optionTop + q.optionBottom) / 2;
  return (
    <AbsoluteFill
      style={{
        transform: `translateY(${(1 - slide) * 120}px)`,
        opacity: slide,
      }}
    >
      <ShotCamera
        src={q.src}
        imageWidth={1170}
        imageHeight={2532}
        viewportWidth={SCREEN_W}
        viewportHeight={SCREEN_H}
        keys={CAMERA}
      >
        <div
          style={{
            position: "absolute",
            left: 114,
            top: q.optionTop,
            width: 942,
            height: q.optionBottom - q.optionTop,
            borderRadius: 40,
            border: `8px solid ${COLORS.yellow}`,
            backgroundColor: "rgba(255,215,0,0.12)",
            opacity: picked,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 986 - 20,
            top: optionMid - 20,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: COLORS.brown,
            transform: `scale(${picked})`,
          }}
        />
        <div
          dir="rtl"
          style={{
            position: "absolute",
            left: 604,
            top: q.sureTop,
            width: 452,
            height: q.sureBottom - q.sureTop,
            borderRadius: 40,
            backgroundColor: COLORS.yellow,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONTS.arabic,
            fontWeight: 700,
            fontSize: 54,
            color: COLORS.brownDeep,
            opacity: sure,
            transform: `scale(${0.94 + sure * 0.06})`,
          }}
        >
          متأكد
        </div>
        <Tap x={986} y={optionMid} atFrame={OPTION_TAP} />
        <Tap x={830} y={(q.sureTop + q.sureBottom) / 2} atFrame={SURE_TAP} />
      </ShotCamera>
    </AbsoluteFill>
  );
};

const SideText: React.FC<{
  readonly block: TextBlock;
  readonly startFrame: number;
}> = ({ block, startFrame }) => {
  const frame = useCurrentFrame();
  const t = progress(frame, startFrame, 24);
  const b = progress(frame, startFrame + 8, 24);
  return (
    <div
      dir="rtl"
      lang="ar"
      style={{
        position: "absolute",
        right: 150,
        top: 340,
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
        {block.title}
      </div>
      <div
        style={{
          fontFamily: FONTS.arabic,
          fontWeight: 400,
          fontSize: 40,
          lineHeight: 1.5,
          color: COLORS.muted,
          opacity: b,
          transform: `translateY(${(1 - b) * 30}px)`,
        }}
      >
        {block.body}
      </div>
    </div>
  );
};

/** Sound effects, in frames from the scene start. */
export const LEARN_SFX: readonly SceneSfx[] = QUESTIONS.flatMap(
  (_: Question, i: number): SceneSfx[] => [
    { at: LESSON_END + i * QUESTION_LEN, sound: "whip", volume: 0.3 },
    {
      at: LESSON_END + i * QUESTION_LEN + OPTION_TAP,
      sound: "mouse-click",
      volume: 0.6,
    },
    {
      at: LESSON_END + i * QUESTION_LEN + SURE_TAP,
      sound: "mouse-click",
      volume: 0.6,
    },
  ],
);

/** Chapter 3: the courier watches the generated lesson (muted) and practises with confidence taps. */
export const Learn: React.FC<Props> = ({
  lessonText,
  practiceText,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 30);
  const onLesson = frame < LESSON_END;
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: 250,
          top: (1080 - SCREEN_H - 32) / 2,
          opacity: enter,
          transform: `perspective(2000px) translateY(${(1 - enter) * 140}px) rotateY(${(1 - enter) * 25 + 8}deg)`,
        }}
      >
        <PhoneFrame screenWidth={SCREEN_W} screenHeight={SCREEN_H}>
          {onLesson ? (
            <ShotCamera
              src="shots/learn-lesson.png"
              imageWidth={1170}
              imageHeight={3474}
              viewportWidth={SCREEN_W}
              viewportHeight={SCREEN_H}
              keys={CAMERA}
            >
              <div
                style={{
                  position: "absolute",
                  left: 50,
                  top: 770,
                  width: 1070,
                  height: 1760,
                  borderRadius: 64,
                  overflow: "hidden",
                  backgroundColor: "#000",
                }}
              >
                <Sequence
                  from={6}
                  durationInFrames={LESSON_CLIP_FRAMES}
                  layout="none"
                >
                  <Video
                    src={staticFile("footage/lesson-delay.mp4")}
                    muted
                    objectFit="cover"
                    style={{ width: "100%", height: "100%" }}
                  />
                </Sequence>
              </div>
            </ShotCamera>
          ) : (
            QUESTIONS.map((q, i) => {
              const from = LESSON_END + i * QUESTION_LEN;
              return (
                // the last question stays on screen until the scene ends
                <Sequence
                  key={q.src}
                  from={from}
                  durationInFrames={
                    i === QUESTIONS.length - 1 ? Infinity : QUESTION_LEN
                  }
                  layout="none"
                >
                  <QuestionScreen q={q} />
                </Sequence>
              );
            })
          )}
        </PhoneFrame>
      </div>
      {onLesson ? (
        <SideText block={lessonText} startFrame={14} />
      ) : (
        <Sequence from={LESSON_END} layout="none">
          <SideText block={practiceText} startFrame={0} />
        </Sequence>
      )}
      <ChapterChip index={chapter.index} label={chapter.label} />
    </AbsoluteFill>
  );
};
