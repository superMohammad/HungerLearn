import type React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  /** Words of the caption; words listed in `highlight` are drawn in yellow. */
  readonly text: string;
  readonly highlight: readonly string[];
  readonly startFrame: number;
  readonly fontSize: number;
  readonly align: "center" | "right";
};

/** Arabic kinetic caption: words rise in one by one (word-level, so letters stay joined). */
export const Caption: React.FC<Props> = ({
  text,
  highlight,
  startFrame,
  fontSize,
  align,
}) => {
  const frame = useCurrentFrame();
  const words: readonly string[] = text.split(" ");
  return (
    <div
      dir="rtl"
      lang="ar"
      style={{
        fontFamily: FONTS.arabic,
        fontWeight: 700,
        fontSize,
        lineHeight: 1.35,
        color: COLORS.cream,
        textAlign: align,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        columnGap: fontSize * 0.28,
      }}
    >
      {words.map((word, i) => {
        const t = progress(frame, startFrame + i * 3, 18);
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              opacity: t,
              transform: `translateY(${(1 - t) * fontSize * 0.5}px)`,
              filter: `blur(${(1 - t) * 8}px)`,
              color: highlight.includes(word) ? COLORS.yellow : COLORS.cream,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
