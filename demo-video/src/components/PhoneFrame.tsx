import type React from "react";

type Props = {
  /** Screen size in CSS px (the app was captured at 390 x 844). */
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly children: React.ReactNode;
};

const BEZEL = 16;

/** Simple modern phone body around a screen area. */
export const PhoneFrame: React.FC<Props> = ({
  screenWidth,
  screenHeight,
  children,
}) => (
  <div
    style={{
      width: screenWidth + BEZEL * 2,
      height: screenHeight + BEZEL * 2,
      borderRadius: 64,
      padding: BEZEL,
      background: "linear-gradient(145deg, #2B1A12, #0F0704)",
      boxShadow:
        "0 70px 140px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,247,224,0.10)",
      position: "relative",
    }}
  >
    <div
      style={{
        width: screenWidth,
        height: screenHeight,
        borderRadius: 48,
        overflow: "hidden",
        position: "relative",
        backgroundColor: "#FFF7E0",
      }}
    >
      {children}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          width: 120,
          height: 34,
          marginLeft: -60,
          borderRadius: 17,
          backgroundColor: "#0B0503",
        }}
      />
    </div>
  </div>
);
