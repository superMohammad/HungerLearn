import type React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Backdrop } from "../components/Backdrop";
import type { SceneSfx } from "../components/SoundTrack";
import { COLORS, FONTS, progress } from "../theme";

type Role = {
  readonly photo: string;
  readonly role: string;
  readonly manual: string;
};

type Props = { readonly headline: string; readonly roles: readonly Role[] };

const CARD_W = 520;
const CARD_H = 600;
const GAP = 44;
const CARD_START = 18;
const CARD_GAP = 12;

/** Sound effects, in frames from the scene start. */
export const ROLES_SFX: readonly SceneSfx[] = [0, 1, 2].map(
  (i: number): SceneSfx => ({
    at: CARD_START + i * CARD_GAP,
    sound: "whip",
    volume: 0.35,
  }),
);

/** Three learner roles, each trained on its own manual. */
export const Roles: React.FC<Props> = ({ headline, roles }) => {
  const frame = useCurrentFrame();
  const head = progress(frame, 0, 22);
  const total = roles.length * CARD_W + (roles.length - 1) * GAP;
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        dir="rtl"
        lang="ar"
        style={{
          position: "absolute",
          top: 90,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: FONTS.arabic,
          fontWeight: 700,
          fontSize: 80,
          color: COLORS.cream,
          opacity: head,
          transform: `translateY(${(1 - head) * 24}px)`,
        }}
      >
        {headline}
      </div>
      {roles.map((r: Role, i: number) => {
        const t = progress(frame, CARD_START + i * CARD_GAP, 24);
        const zoom = interpolate(frame, [0, 170], [1.12, 1.0]);
        return (
          <div
            key={r.role}
            dir="rtl"
            style={{
              position: "absolute",
              // RTL: the first role sits on the right
              right: (1920 - total) / 2 + i * (CARD_W + GAP),
              top: 270,
              width: CARD_W,
              height: CARD_H,
              borderRadius: 32,
              overflow: "hidden",
              boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
              opacity: t,
              transform: `translateY(${(1 - t) * 80}px)`,
            }}
          >
            <Img
              src={staticFile(r.photo)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${zoom})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(30,11,4,0) 35%, rgba(30,11,4,0.92) 100%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 34,
                left: 34,
                bottom: 34,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                style={{
                  alignSelf: "flex-start",
                  fontFamily: FONTS.arabic,
                  fontWeight: 700,
                  fontSize: 24,
                  color: COLORS.ink,
                  backgroundColor: COLORS.yellow,
                  padding: "6px 18px",
                  borderRadius: 999,
                }}
              >
                {r.role}
              </span>
              <span
                style={{
                  fontFamily: FONTS.arabic,
                  fontWeight: 700,
                  fontSize: 40,
                  color: COLORS.cream,
                  lineHeight: 1.3,
                }}
              >
                {r.manual}
              </span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
