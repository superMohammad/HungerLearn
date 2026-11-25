import type React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { mix, travel } from "../theme";

/** Camera position: focus point (cx, cy) in screenshot pixels and display pixels per screenshot pixel. */
export type CameraKey = {
  readonly frame: number;
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
};

type Props = {
  readonly src: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly keys: readonly CameraKey[];
  /** Overlays positioned in screenshot pixels; they move with the camera. */
  readonly children: React.ReactNode;
};

const cameraAt = (frame: number, keys: readonly CameraKey[]): CameraKey => {
  if (keys.length === 0)
    throw new Error("ShotCamera needs at least one camera key");
  const first: CameraKey = keys[0];
  if (frame <= first.frame) return first;
  for (let i = 1; i < keys.length; i++) {
    const a: CameraKey = keys[i - 1];
    const b: CameraKey = keys[i];
    if (frame <= b.frame) {
      const t: number = travel(frame, a.frame, b.frame - a.frame);
      return {
        frame,
        cx: mix(a.cx, b.cx, t),
        cy: mix(a.cy, b.cy, t),
        scale: mix(a.scale, b.scale, t),
      };
    }
  }
  return keys[keys.length - 1];
};

/** Pans and zooms over a high-DPI app screenshot like a camera moving over a live screen. */
export const ShotCamera: React.FC<Props> = ({
  src,
  imageWidth,
  imageHeight,
  viewportWidth,
  viewportHeight,
  keys,
  children,
}) => {
  const frame = useCurrentFrame();
  const cam: CameraKey = cameraAt(frame, keys);
  const x: number = viewportWidth / 2 - cam.cx * cam.scale;
  const y: number = viewportHeight / 2 - cam.cy * cam.scale;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#FFF7E0",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: imageWidth,
          height: imageHeight,
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${cam.scale})`,
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: imageWidth,
            height: imageHeight,
            maxWidth: "none",
          }}
        />
        {children}
      </div>
    </div>
  );
};
