import type React from "react";
import { PhoneFrame } from "./PhoneFrame";
import { type CameraKey, ShotCamera } from "./ShotCamera";

export const PHONE_SCREEN_W = 406;
export const PHONE_SCREEN_H = 880;
/** Learner screenshots are 1170 px wide (390 css px at DPR 3). */
export const PHONE_SCALE = PHONE_SCREEN_W / 1170;
const STATUS_BAR = 44;

/** Camera that shows the top of a phone screenshot below the status bar. */
export const PHONE_TOP: readonly CameraKey[] = [
  {
    frame: 0,
    cx: 585,
    cy: (PHONE_SCREEN_H / 2 - STATUS_BAR) / PHONE_SCALE,
    scale: PHONE_SCALE,
  },
];

type Props = {
  readonly src: string;
  readonly imageHeight: number;
  readonly children: React.ReactNode;
};

/** A phone showing the top of a learner screenshot; children are overlays in screenshot pixels. */
export const PhoneShot: React.FC<Props> = ({ src, imageHeight, children }) => (
  <PhoneFrame screenWidth={PHONE_SCREEN_W} screenHeight={PHONE_SCREEN_H}>
    <ShotCamera
      src={src}
      imageWidth={1170}
      imageHeight={imageHeight}
      viewportWidth={PHONE_SCREEN_W}
      viewportHeight={PHONE_SCREEN_H}
      keys={PHONE_TOP}
    >
      {children}
    </ShotCamera>
  </PhoneFrame>
);
