import { Video } from "@remotion/media";
import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "../theme";

type Props = {
  readonly src: string;
  readonly blurPx: number;
  readonly startFrom: number;
  readonly playbackRate: number;
};

/** Full-frame footage, heavily blurred and tinted brown, drifting slowly (used behind the logo). */
export const BlurredFootage: React.FC<Props> = ({
  src,
  blurPx,
  startFrom,
  playbackRate,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1.18, 1.3]);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${zoom})`,
          filter: `blur(${blurPx}px) saturate(0.9) brightness(0.75)`,
        }}
      >
        <Video
          src={staticFile(src)}
          trimBefore={startFrom}
          playbackRate={playbackRate}
          muted
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 50%, rgba(71, 28, 9, 0.55) 0%, rgba(30, 11, 4, 0.9) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
