import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React from "react";
import { AbsoluteFill } from "remotion";
import { type SceneSfx, type SfxCue, SoundTrack } from "./SoundTrack";

/** Frames of the cross-fade between scenes; each fade overlaps two scenes. */
export const FADE = 8;
/** A whoosh lands this many frames before each scene change. */
const CUT_WHOOSH_LEAD = 4;

/** One scene on the timeline with its own sound effects (frames relative to the scene start). */
export type Slot = {
  readonly name: string;
  readonly duration: number;
  readonly sfx: readonly SceneSfx[];
  readonly content: React.ReactNode;
};

/** Total length of scenes joined by FADE-frame cross-fades. */
export const totalFrames = (durations: readonly number[]): number =>
  durations.reduce((sum: number, d: number) => sum + d, 0) -
  (durations.length - 1) * FADE;

const startFrames = (slots: readonly Slot[]): readonly number[] =>
  slots.map((_: Slot, i: number) =>
    slots
      .slice(0, i)
      .reduce((sum: number, s: Slot) => sum + s.duration - FADE, 0),
  );

const cuesFor = (slots: readonly Slot[]): readonly SfxCue[] => {
  const starts: readonly number[] = startFrames(slots);
  return slots.flatMap((slot: Slot, i: number): SfxCue[] => [
    ...(i > 0
      ? [
          {
            frame: starts[i] - CUT_WHOOSH_LEAD,
            sound: "whoosh" as const,
            volume: 0.45,
          },
        ]
      : []),
    ...slot.sfx.map(
      (s: SceneSfx): SfxCue => ({
        frame: starts[i] + s.at,
        sound: s.sound,
        volume: s.volume,
      }),
    ),
  ]);
};

/** Plays scenes back to back with short fades, plus all their sound effects. */
export const Timeline: React.FC<{ readonly slots: readonly Slot[] }> = ({
  slots,
}) => {
  const timing = linearTiming({ durationInFrames: FADE });
  return (
    <AbsoluteFill style={{ backgroundColor: "#1E0B04" }}>
      <TransitionSeries>
        {slots.map((slot: Slot, i: number) => (
          <React.Fragment key={slot.name}>
            {i > 0 ? (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={timing}
              />
            ) : null}
            <TransitionSeries.Sequence
              name={slot.name}
              durationInFrames={slot.duration}
            >
              {slot.content}
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}
      </TransitionSeries>
      <SoundTrack cues={cuesFor(slots)} />
    </AbsoluteFill>
  );
};
