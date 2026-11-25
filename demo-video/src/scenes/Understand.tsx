import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame, BROWSER_BAR_HEIGHT } from "../components/BrowserFrame";
import { Caption } from "../components/Caption";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import type { SceneSfx } from "../components/SoundTrack";
import { ShotCamera } from "../components/ShotCamera";
import { CLAUSE_2_HASH, CLAUSES, SOP_TITLE } from "../data";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly caption: string;
  readonly captionHighlight: readonly string[];
  /** Extra frames for the dive into clause #2 and the hold on its focus box (0 = the fast 60 s pacing). */
  readonly focusHold: number;
  readonly chapter: Chapter;
};

const FRAME_W = 1560;
const FRAME_H = 860;
const VIEW_H = FRAME_H - BROWSER_BAR_HEIGHT;
// admin-document.png is 3200 x 6612 (DPR 2); clause #2's quote box is centred near (1600, 1935).
const FIT = FRAME_W / 3200;
/** Frame where the camera lands on clause #2 and the frame where the scene cuts to the citation view. */
type Pace = { readonly diveEnd: number; readonly split: number };

const paceFor = (focusHold: number): Pace => ({
  diveEnd: 92 + Math.round(focusHold / 2),
  split: 128 + focusHold,
});

/** Part A: the processed manual in the app, camera dives into clause #2. */
const AppView: React.FC<{ readonly pace: Pace }> = ({ pace }) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 36);
  const exit = progress(frame, pace.split - 18, 18);
  const glow = progress(frame, pace.diveEnd, 20) * (1 - exit);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        perspective: 2200,
      }}
    >
      <div
        style={{
          transform: `translateY(${(1 - enter) * 160 + 40}px) rotateX(${(1 - enter) * 22}deg) scale(${0.92 + enter * 0.08 + exit * 0.25})`,
          opacity: enter * (1 - exit),
          filter: `blur(${exit * 14}px)`,
        }}
      >
        <BrowserFrame
          width={FRAME_W}
          height={FRAME_H}
          url="hungerlearn.app/admin/documents/courier-pickup-wait"
        >
          <ShotCamera
            src="shots/admin-document.png"
            imageWidth={3200}
            imageHeight={6612}
            viewportWidth={FRAME_W}
            viewportHeight={VIEW_H}
            keys={[
              { frame: 0, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
              { frame: 34, cx: 1600, cy: VIEW_H / 2 / FIT + 120, scale: FIT },
              { frame: pace.diveEnd, cx: 1600, cy: 1935, scale: 0.62 },
            ]}
          >
            {/* clause #2 quote box in screenshot pixels */}
            <div
              style={{
                position: "absolute",
                left: 420,
                top: 1848,
                width: 2380,
                height: 170,
                borderRadius: 28,
                border: `7px solid ${COLORS.yellow}`,
                boxShadow: `0 0 0 9999px rgba(30,11,4,${0.55 * glow}), 0 0 90px rgba(255,215,0,${0.6 * glow})`,
                opacity: glow,
              }}
            />
          </ShotCamera>
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

const PAPER = { x: 1010, y: 150, w: 720, h: 780 } as const;
const CARD = { x: 170, y: 330, w: 700, h: 300 } as const;
// Each clause on the paper occupies one row of this height.
const ROW_H = 132;
const FIRST_ROW_Y = 150;

/** Part B: the extracted clause card points back to the exact sentence in the source page. */
const CitationView: React.FC<{ readonly split: number }> = ({ split }) => {
  const frame = useCurrentFrame() - split;
  const paperIn = progress(frame, 0, 26);
  const cardIn = progress(frame, 12, 26);
  const line = progress(frame, 34, 26);
  const underline = progress(frame, 52, 30);
  const targetY = PAPER.y + FIRST_ROW_Y + ROW_H + 52;
  const startX = CARD.x + CARD.w;
  const startY = CARD.y + CARD.h / 2;
  const endX = PAPER.x + 34;
  const pathD = `M ${startX} ${startY} C ${startX + 110} ${startY}, ${endX - 110} ${targetY}, ${endX} ${targetY}`;
  return (
    <AbsoluteFill>
      <div
        dir="rtl"
        lang="ar"
        style={{
          position: "absolute",
          left: PAPER.x,
          top: PAPER.y,
          width: PAPER.w,
          height: PAPER.h,
          backgroundColor: COLORS.creamSoft,
          borderRadius: 14,
          padding: "44px 48px",
          boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
          opacity: paperIn,
          transform: `translateY(${(1 - paperIn) * 60}px) rotate(${(1 - paperIn) * 3}deg)`,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.naskh,
            fontWeight: 700,
            fontSize: 34,
            color: COLORS.brownDeep,
          }}
        >
          {SOP_TITLE}
        </div>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 16,
            color: COLORS.brown,
            opacity: 0.7,
            marginTop: 6,
          }}
        >
          courier-pickup-wait · v1
        </div>
        {CLAUSES.slice(0, 4).map((c, i) => {
          const isTarget = i === 1;
          return (
            <div
              key={c.number}
              style={{
                position: "absolute",
                top: FIRST_ROW_Y + i * ROW_H,
                right: 48,
                left: 48,
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.arabic,
                  fontWeight: 700,
                  fontSize: 21,
                  color: COLORS.brown,
                }}
              >
                {c.number}. {c.headingV1}
              </div>
              <div
                style={{
                  position: "relative",
                  fontFamily: FONTS.naskh,
                  fontSize: 25,
                  lineHeight: 1.6,
                  color: COLORS.brownDeep,
                  opacity: isTarget ? 1 : 1 - underline * 0.55,
                }}
              >
                {isTarget ? (
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      bottom: 2,
                      right: 0,
                      width: `${underline * 100}%`,
                      backgroundColor: "rgba(255,215,0,0.55)",
                      borderRadius: 6,
                    }}
                  />
                ) : null}
                <span style={{ position: "relative" }}>{c.text}</span>
              </div>
            </div>
          );
        })}
      </div>
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        <path
          d={pathD}
          fill="none"
          stroke={COLORS.yellow}
          strokeWidth={4}
          strokeDasharray={900}
          strokeDashoffset={900 * (1 - line)}
          strokeLinecap="round"
        />
        <circle cx={endX} cy={targetY} r={10 * line} fill={COLORS.yellow} />
        <circle cx={startX} cy={startY} r={9 * cardIn} fill={COLORS.yellow} />
      </svg>
      <div
        dir="rtl"
        lang="ar"
        style={{
          position: "absolute",
          left: CARD.x,
          top: CARD.y,
          width: CARD.w,
          minHeight: CARD.h,
          borderRadius: 28,
          backgroundColor: "#FFFDF5",
          padding: "34px 40px",
          boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
          opacity: cardIn,
          transform: `translateX(${(1 - cardIn) * -80}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 22,
              color: COLORS.brown,
            }}
          >
            #2
          </span>
          <span
            style={{
              fontFamily: FONTS.arabic,
              fontWeight: 700,
              fontSize: 38,
              color: COLORS.brownDeep,
            }}
          >
            تأخر تجهيز الطلب
          </span>
        </div>
        <div
          style={{
            marginTop: 18,
            padding: "20px 24px",
            borderRadius: 18,
            backgroundColor: "#FBF1D3",
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 17,
              color: COLORS.brown,
              opacity: 0.75,
              textAlign: "left",
            }}
          >
            {CLAUSE_2_HASH}
          </div>
          <div
            style={{
              fontFamily: FONTS.naskh,
              fontSize: 26,
              lineHeight: 1.6,
              color: COLORS.brownDeep,
            }}
          >
            {CLAUSES[1].text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Sound effects, in frames from the scene start. */
export const understandSfx = (focusHold: number): readonly SceneSfx[] => {
  const pace: Pace = paceFor(focusHold);
  return [
    { at: pace.diveEnd, sound: "switch", volume: 0.5 },
    { at: pace.split, sound: "page-turn", volume: 0.45 },
    { at: pace.split + 34, sound: "whip", volume: 0.4 },
    { at: pace.split + 52, sound: "ding", volume: 0.25 },
  ];
};

/** Chapter 1: the manual is read clause by clause, each rule cited to its exact source text. */
export const Understand: React.FC<Props> = ({
  caption,
  captionHighlight,
  focusHold,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const pace: Pace = paceFor(focusHold);
  return (
    <AbsoluteFill>
      <Backdrop />
      {frame < pace.split ? (
        <AppView pace={pace} />
      ) : (
        <CitationView split={pace.split} />
      )}
      <ChapterChip index={chapter.index} label={chapter.label} />
      {frame >= pace.split + 70 ? (
        <div
          style={{ position: "absolute", left: 120, right: 120, bottom: 56 }}
        >
          <Caption
            text={caption}
            highlight={captionHighlight}
            startFrame={pace.split + 70}
            fontSize={58}
            align="center"
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
