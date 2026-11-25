import type React from "react";
import { COLORS, FONTS } from "../theme";

type Props = {
  readonly width: number;
  readonly height: number;
  readonly url: string;
  readonly children: React.ReactNode;
};

export const BROWSER_BAR_HEIGHT = 56;

/** Minimal desktop browser window that holds a ShotCamera. */
export const BrowserFrame: React.FC<Props> = ({
  width,
  height,
  url,
  children,
}) => (
  <div
    style={{
      width,
      height,
      borderRadius: 22,
      overflow: "hidden",
      backgroundColor: "#FFFDF5",
      boxShadow:
        "0 60px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,247,224,0.12)",
      position: "relative",
    }}
  >
    <div
      style={{
        height: BROWSER_BAR_HEIGHT,
        display: "flex",
        alignItems: "center",
        padding: "0 22px",
        gap: 10,
        backgroundColor: "#F3E6C4",
        borderBottom: "1px solid rgba(94,45,32,0.12)",
      }}
    >
      {["#E0B9A6", "#E8CF8F", "#C9C2A0"].map((c) => (
        <span
          key={c}
          style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c }}
        />
      ))}
      <div
        style={{
          marginLeft: 24,
          flex: 1,
          maxWidth: 560,
          height: 32,
          borderRadius: 16,
          backgroundColor: "#FFF9E8",
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          fontFamily: FONTS.mono,
          fontSize: 17,
          color: COLORS.brown,
        }}
      >
        {url}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        top: BROWSER_BAR_HEIGHT,
        left: 0,
        width,
        height: height - BROWSER_BAR_HEIGHT,
      }}
    >
      {children}
    </div>
  </div>
);
