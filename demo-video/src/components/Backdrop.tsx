import type React from "react";
import { AbsoluteFill } from "remotion";
import { COLORS } from "../theme";

/** Deep-brown radial background with vignette, shared by all product scenes. */
export const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 80% 70% at 50% 45%, #3E1A0B 0%, ${COLORS.deep} 55%, ${COLORS.ink} 100%)`,
    }}
  />
);
