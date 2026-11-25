import type React from "react";
import { useCurrentFrame } from "remotion";
import { COLORS, FONTS, progress } from "../theme";

/** Chapter marker content; the index is a two-digit string such as "01". */
export type Chapter = { readonly index: string; readonly label: string };

type Props = Chapter;

/** Top-right chapter marker, e.g. "01 · يقرأ الدليل". */
export const ChapterChip: React.FC<Props> = ({ index, label }) => {
  const frame = useCurrentFrame();
  const t = progress(frame, 4, 20);
  return (
    <div
      dir="rtl"
      style={{
        position: "absolute",
        top: 72,
        right: 96,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: t,
        transform: `translateX(${(1 - t) * 40}px)`,
      }}
    >
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 26,
          color: COLORS.yellow,
          letterSpacing: 2,
        }}
      >
        {index}
      </span>
      <span
        style={{
          width: 44,
          height: 2,
          background: COLORS.yellow,
          opacity: 0.7,
        }}
      />
      <span
        style={{
          fontFamily: FONTS.arabic,
          fontSize: 34,
          fontWeight: 500,
          color: COLORS.cream,
        }}
      >
        {label}
      </span>
    </div>
  );
};
