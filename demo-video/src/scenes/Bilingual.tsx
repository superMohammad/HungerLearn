import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { PhoneShot } from "../components/PhoneShot";
import type { SceneSfx } from "../components/SoundTrack";
import { Tap } from "../components/Tap";
import { COLORS, FONTS, progress } from "../theme";

type Props = { readonly headline: string; readonly body: string };

const SWITCH_AT = 46;

/** Sound effects, in frames from the scene start. */
export const BILINGUAL_SFX: readonly SceneSfx[] = [
  { at: SWITCH_AT, sound: "mouse-click", volume: 0.6 },
  { at: SWITCH_AT + 4, sound: "whip", volume: 0.4 },
];

/** Arabic-first UI that switches fully to English in one tap (the public landing page). */
export const Bilingual: React.FC<Props> = ({ headline, body }) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 24);
  const flip = progress(frame, SWITCH_AT + 2, 18);
  const head = progress(frame, 12, 22);
  const sub = progress(frame, 70, 22);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: 250,
          top: (1080 - 912) / 2,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 120}px)`,
          perspective: 2400,
        }}
      >
        <div
          style={{
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `rotateY(${flip * 180}deg)`,
          }}
        >
          <div style={{ backfaceVisibility: "hidden" }}>
            <PhoneShot src="shots/landing-ar.png" imageHeight={2532}>
              {/* the "English" toggle in the header */}
              <Tap x={528} y={93} atFrame={SWITCH_AT} />
            </PhoneShot>
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <PhoneShot src="shots/landing-en.png" imageHeight={2532}>
              {null}
            </PhoneShot>
          </div>
        </div>
      </div>
      <div
        dir="rtl"
        lang="ar"
        style={{
          position: "absolute",
          right: 150,
          top: 380,
          width: 900,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.arabic,
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            color: COLORS.cream,
            opacity: head,
            transform: `translateY(${(1 - head) * 30}px)`,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontFamily: FONTS.arabic,
            fontSize: 40,
            lineHeight: 1.5,
            color: COLORS.muted,
            opacity: sub,
            transform: `translateY(${(1 - sub) * 30}px)`,
          }}
        >
          {body}
        </div>
      </div>
    </AbsoluteFill>
  );
};
