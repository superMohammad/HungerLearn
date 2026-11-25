import type React from "react";
import type { SceneSfx } from "../components/SoundTrack";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BlurredFootage } from "../components/BlurredFootage";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly footage: string;
  readonly tagline: string;
  readonly team: readonly string[];
};

/** Sound effects, in frames from the scene start. */
export const OUTRO_SFX: readonly SceneSfx[] = [
  { at: 32, sound: "ding", volume: 0.25 },
];

/** Closing card mirroring the opening: logo over blurred footage, tagline and team names. */
export const Outro: React.FC<Props> = ({ footage, tagline, team }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const logo = progress(frame, 0, 30);
  const tag = progress(frame, 16, 22);
  const names = progress(frame, 30, 22);
  const fadeOut = progress(frame, durationInFrames - 12, 12);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ opacity: 1 - fadeOut }}>
        <BlurredFootage
          src={footage}
          blurPx={30}
          startFrom={30}
          playbackRate={0.6}
        />
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 40,
          }}
        >
          <Img
            src={staticFile("brand/hungerlearn-logo-light.png")}
            style={{
              width: 440,
              opacity: logo,
              transform: `scale(${1.06 - logo * 0.06})`,
              filter: `blur(${(1 - logo) * 18}px)`,
            }}
          />
          <div
            dir="rtl"
            lang="ar"
            style={{
              fontFamily: FONTS.arabic,
              fontWeight: 500,
              fontSize: 48,
              color: COLORS.cream,
              opacity: tag,
              transform: `translateY(${(1 - tag) * 20}px)`,
            }}
          >
            {tagline}
          </div>
          <div
            style={{
              width: 80 * names,
              height: 2,
              backgroundColor: COLORS.yellow,
              marginTop: 10,
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 46,
              fontFamily: FONTS.mono,
              fontSize: 28,
              color: COLORS.cream,
              opacity: names,
              transform: `translateY(${(1 - names) * 16}px)`,
            }}
          >
            {team.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
