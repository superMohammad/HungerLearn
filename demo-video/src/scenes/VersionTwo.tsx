import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import type { SceneSfx } from "../components/SoundTrack";
import { CLAUSES, type SopClause } from "../data";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly unchangedLabel: string;
  readonly movedLabel: string;
  readonly retrainLabel: string;
  readonly headline: string;
  readonly subline: string;
  readonly chapter: Chapter;
};

const COL_W = 640;
const ROW_H = 50;
const ROW_GAP = 6;
const TOP = 210;
const V1_X = 1920 / 2 + 120;
const V2_X = 1920 / 2 - 120 - COL_W;
const CASCADE = 3;
const MATCH_START = 44;
const FOCUS_START = 110;
const COUNTER_START = 176;

const rowY = (i: number): number => TOP + 70 + i * (ROW_H + ROW_GAP);

type RowProps = {
  readonly clause: SopClause;
  readonly index: number;
  readonly version: 1 | 2;
  readonly x: number;
  /** Status tag shown at the row's end (v2 column only). */
  readonly tag: string | null;
};

const Row: React.FC<RowProps> = ({ clause, index, version, x, tag }) => {
  const frame = useCurrentFrame();
  const t = progress(frame, index * CASCADE + (version === 2 ? 6 : 0), 20);
  const settle = progress(frame, MATCH_START + index * 3, 16);
  const focus = progress(frame, FOCUS_START, 20);
  const isChanged = clause.change === "changed";
  const dim = isChanged ? 0 : settle * 0.55 + focus * 0.15;
  const heading = version === 1 ? clause.headingV1 : clause.headingV2;
  return (
    <div
      dir="rtl"
      style={{
        position: "absolute",
        left: x,
        top: rowY(index),
        width: COL_W,
        height: ROW_H,
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 22px",
        backgroundColor: isChanged
          ? `rgba(255,215,0,${0.08 + focus * 0.9})`
          : "rgba(255,247,224,0.07)",
        border: `1px solid ${isChanged && focus > 0 ? COLORS.yellow : COLORS.line}`,
        boxShadow: isChanged
          ? `0 0 ${60 * focus}px rgba(255,215,0,${0.5 * focus})`
          : "none",
        opacity: t * (1 - dim),
        transform: `translateY(${(1 - t) * 20}px) scale(${isChanged ? 1 + focus * 0.04 : 1})`,
        zIndex: isChanged ? 2 : 1,
      }}
    >
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 22,
          color: isChanged && focus > 0.5 ? COLORS.ink : COLORS.yellow,
          width: 34,
        }}
      >
        {clause.number}
      </span>
      <span
        style={{
          fontFamily: FONTS.arabic,
          fontWeight: 500,
          fontSize: 28,
          color: isChanged && focus > 0.5 ? COLORS.ink : COLORS.cream,
          flex: 1,
        }}
      >
        {heading}
      </span>
      {tag !== null ? (
        <span
          style={{
            fontFamily: FONTS.arabic,
            fontSize: 21,
            fontWeight: isChanged ? 700 : 400,
            color: isChanged ? COLORS.ink : COLORS.cream,
            opacity: isChanged
              ? focus
              : progress(frame, MATCH_START + 10 + index * 3, 14) * 0.8,
            whiteSpace: "nowrap",
          }}
        >
          {tag}
        </span>
      ) : null}
    </div>
  );
};

/** Sound effects, in frames from the scene start. */
export const VERSION_TWO_SFX: readonly SceneSfx[] = [
  { at: MATCH_START, sound: "page-turn", volume: 0.4 },
  { at: FOCUS_START, sound: "whip", volume: 0.45 },
  { at: FOCUS_START + 30, sound: "switch", volume: 0.5 },
  { at: COUNTER_START, sound: "whoosh", volume: 0.5 },
  { at: COUNTER_START + 4, sound: "ding", volume: 0.35 },
];

/** Chapter 5: v2 arrives; only the clause whose meaning changed is sent back for retraining. */
export const VersionTwo: React.FC<Props> = ({
  unchangedLabel,
  movedLabel,
  retrainLabel,
  headline,
  subline,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const focus = progress(frame, FOCUS_START, 20);
  const diff = progress(frame, FOCUS_START + 22, 22);
  const counter = progress(frame, COUNTER_START, 22);
  const listFade = 1 - progress(frame, COUNTER_START - 6, 18) * 0.85;
  const headerT = progress(frame, 0, 20);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{ opacity: listFade, filter: `blur(${(1 - listFade) * 8}px)` }}
      >
        {[
          { x: V1_X, label: "النسخة ١", version: 1 as const },
          { x: V2_X, label: "النسخة ٢", version: 2 as const },
        ].map((col) => (
          <div
            key={col.label}
            style={{
              position: "absolute",
              left: col.x,
              top: TOP,
              width: COL_W,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              opacity: headerT,
            }}
            dir="rtl"
          >
            <span
              style={{
                fontFamily: FONTS.arabic,
                fontWeight: 700,
                fontSize: 38,
                color: COLORS.cream,
              }}
            >
              {col.label}
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 20,
                color: COLORS.muted,
              }}
            >
              courier-pickup-wait · v{col.version}
            </span>
          </div>
        ))}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0 }}
        >
          {CLAUSES.map((c, i) => {
            const t = progress(frame, MATCH_START + i * 3, 14);
            const y = rowY(i) + ROW_H / 2;
            const isChanged = c.change === "changed";
            return (
              <line
                key={c.number}
                x1={V1_X}
                y1={y}
                x2={V2_X + COL_W}
                y2={y}
                stroke={isChanged ? COLORS.yellow : "rgba(255,247,224,0.25)"}
                strokeWidth={isChanged ? 3 + focus * 3 : 2}
                strokeDasharray={240}
                strokeDashoffset={240 * (1 - t)}
              />
            );
          })}
        </svg>
        {CLAUSES.map((c, i) => (
          <Row
            key={`v1-${c.number}`}
            clause={c}
            index={i}
            version={1}
            x={V1_X}
            tag={null}
          />
        ))}
        {CLAUSES.map((c, i) => (
          <Row
            key={`v2-${c.number}`}
            clause={c}
            index={i}
            version={2}
            x={V2_X}
            tag={
              c.change === "unchanged"
                ? unchangedLabel
                : c.change === "moved"
                  ? movedLabel
                  : retrainLabel
            }
          />
        ))}
        {/* the actual text change of clause 2: ١٥ دقيقة -> 10 دقائق */}
        <div
          dir="rtl"
          style={{
            position: "absolute",
            left: V2_X,
            width: V1_X + COL_W - V2_X,
            top: rowY(CLAUSES.length) + 26,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 26,
            fontFamily: FONTS.naskh,
            fontSize: 40,
            color: COLORS.cream,
            opacity: diff,
            transform: `translateY(${(1 - diff) * 20}px)`,
          }}
        >
          <span>قيد التجهيز بعد</span>
          <span style={{ position: "relative", color: COLORS.muted }}>
            ١٥ دقيقة
            <span
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 4,
                width: `${interpolate(diff, [0.3, 1], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}%`,
                backgroundColor: COLORS.yellow,
              }}
            />
          </span>
          <span
            style={{
              color: COLORS.ink,
              backgroundColor: COLORS.yellow,
              padding: "0 16px",
              borderRadius: 10,
              fontWeight: 700,
            }}
          >
            10 دقائق
          </span>
          <span>من تسجيل الوصول</span>
        </div>
      </AbsoluteFill>
      {counter > 0 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            dir="rtl"
            style={{
              fontFamily: FONTS.arabic,
              fontWeight: 700,
              fontSize: 132,
              color: COLORS.cream,
              opacity: counter,
              transform: `scale(${1.25 - counter * 0.25})`,
              filter: `blur(${(1 - counter) * 14}px)`,
            }}
          >
            {headline.split(" ").map((w, i) => (
              <span
                key={`${w}-${i}`}
                style={{ color: i < 2 ? COLORS.yellow : COLORS.cream }}
              >
                {w}{" "}
              </span>
            ))}
          </div>
          <div
            dir="rtl"
            style={{
              fontFamily: FONTS.arabic,
              fontSize: 46,
              color: COLORS.muted,
              opacity: progress(frame, COUNTER_START + 14, 20),
            }}
          >
            {subline}
          </div>
        </AbsoluteFill>
      ) : null}
      <ChapterChip index={chapter.index} label={chapter.label} />
    </AbsoluteFill>
  );
};
