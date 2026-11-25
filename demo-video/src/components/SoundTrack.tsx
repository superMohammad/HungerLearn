import { Audio } from "@remotion/media";
import type React from "react";
import { Sequence, staticFile } from "remotion";

export type SfxName =
  | "whoosh"
  | "whip"
  | "page-turn"
  | "switch"
  | "mouse-click"
  | "shutter-modern"
  | "ding";

/** One sound effect at a frame relative to the start of its scene. */
export type SceneSfx = {
  readonly at: number;
  readonly sound: SfxName;
  readonly volume: number;
};

/** One sound effect fired at an absolute composition frame. */
export type SfxCue = {
  readonly frame: number;
  readonly sound: SfxName;
  readonly volume: number;
};

type Props = { readonly cues: readonly SfxCue[] };

/** Timed sound effects (the video has no music). */
export const SoundTrack: React.FC<Props> = ({ cues }) => (
  <>
    {cues.map((cue, i) => (
      <Sequence
        key={`${cue.sound}-${cue.frame}-${i}`}
        from={cue.frame}
        durationInFrames={60}
        layout="none"
        name={`SFX ${cue.sound}`}
      >
        <Audio src={staticFile(`sfx/${cue.sound}.wav`)} volume={cue.volume} />
      </Sequence>
    ))}
  </>
);
