import { lightLeak } from "@remotion/effects/light-leak";
import type React from "react";
import type { SceneSfx } from "../components/SoundTrack";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Solid,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BlurredFootage } from "../components/BlurredFootage";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly footage: string;
  readonly tagline: string;
};

const LOGO_WIDTH = 620;

/** Sound effects, in frames from the scene start. */
export const LOGO_INTRO_SFX: readonly SceneSfx[] = [
  { at: 10, sound: "whoosh", volume: 0.5 },
  { at: 54, sound: "ding", volume: 0.25 },
];

/** Opening: the logo resolves from blur at the centre over blurred courier footage. */
export const LogoIntro: React.FC<Props> = ({ footage, tagline }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const reveal = progress(frame, 8, 42);
  const tag = progress(frame, 58, 24);
  const exit = progress(frame, durationInFrames - 16, 16);
  // A light sweep crosses the logo once it is sharp.
  const sweep = interpolate(frame, [52, 82], [-0.4, 1.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <BlurredFootage
        src={footage}
        blurPx={34}
        startFrom={0}
        playbackRate={0.6}
      />
      <AbsoluteFill style={{ opacity: 0.22, mixBlendMode: "screen" }}>
        <Solid
          width={width}
          height={height}
          effects={[
            lightLeak({
              seed: 3,
              hueShift: 0,
              progress: interpolate(frame, [0, durationInFrames], [0.1, 0.9]),
            }),
          ]}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 44,
          opacity: 1 - exit,
          transform: `scale(${1 + exit * 0.06})`,
          filter: `blur(${exit * 10}px)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: LOGO_WIDTH,
            opacity: reveal,
            transform: `scale(${0.9 + reveal * 0.1})`,
            filter: `blur(${(1 - reveal) * 26}px) drop-shadow(0 18px 50px rgba(0,0,0,0.45))`,
          }}
        >
          <Img
            src={staticFile("brand/hungerlearn-logo-light.png")}
            style={{ width: LOGO_WIDTH, display: "block" }}
          />
          <AbsoluteFill
            style={{
              WebkitMaskImage: `url(${staticFile("brand/hungerlearn-logo-light.png")})`,
              WebkitMaskSize: "100% 100%",
              background: `linear-gradient(105deg, transparent ${sweep * 100 - 18}%, rgba(255,215,0,0.9) ${sweep * 100}%, transparent ${sweep * 100 + 18}%)`,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            dir="rtl"
            lang="ar"
            style={{
              fontFamily: FONTS.arabic,
              fontWeight: 500,
              fontSize: 50,
              color: COLORS.cream,
              opacity: tag,
              transform: `translateY(${(1 - tag) * 24}px)`,
            }}
          >
            {tagline}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
