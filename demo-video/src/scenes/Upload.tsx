import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrowserFrame, BROWSER_BAR_HEIGHT } from "../components/BrowserFrame";
import { Caption } from "../components/Caption";
import { type Chapter, ChapterChip } from "../components/ChapterChip";
import { ShotCamera } from "../components/ShotCamera";
import type { SceneSfx } from "../components/SoundTrack";
import { Tap } from "../components/Tap";
import { COLORS, FONTS, progress } from "../theme";

type Props = {
  readonly fileName: string;
  readonly caption: string;
  readonly captionHighlight: readonly string[];
  readonly chapter: Chapter;
};

const FRAME_W = 1560;
const FRAME_H = 800;
const VIEW_H = FRAME_H - BROWSER_BAR_HEIGHT;
const FIT = FRAME_W / 3200;
const DROP = 40;
const SUBMIT_TAP = 72;
const SPLIT = 96;
const STEP_START = SPLIT + 18;
const STEP_GAP = 9;
// admin-document.png "سير المعالجة" rows, bottom (first event) to top, centre y in screenshot px.
const STEP_ROWS: readonly number[] = [985, 921, 857, 793, 729, 665, 600];

/** Part A: the manual is dropped into the upload form (admin-home.png, 3200 x 2000). */
const UploadForm: React.FC<{ readonly fileName: string }> = ({ fileName }) => {
  const frame = useCurrentFrame();
  const drop = progress(frame, DROP, 18);
  return (
    <ShotCamera
      src="shots/admin-home.png"
      imageWidth={3200}
      imageHeight={2000}
      viewportWidth={FRAME_W}
      viewportHeight={VIEW_H}
      keys={[
        { frame: 0, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
        { frame: 14, cx: 1600, cy: VIEW_H / 2 / FIT, scale: FIT },
        { frame: 44, cx: 780, cy: 1180, scale: 0.78 },
      ]}
    >
      {/* the dropped file replaces "No file chosen" in the file field */}
      <div
        dir="ltr"
        style={{
          position: "absolute",
          left: 446,
          top: 1362,
          width: 634,
          height: 74,
          borderRadius: 18,
          backgroundColor: "#FFF8E1",
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 22px",
          opacity: drop,
          transform: `translateY(${(1 - drop) * -120}px) scale(${1.15 - drop * 0.15})`,
          boxShadow: `0 ${30 * (1 - drop)}px 60px rgba(0,0,0,${0.35 * (1 - drop)})`,
        }}
      >
        <span
          style={{
            width: 40,
            height: 50,
            borderRadius: 6,
            backgroundColor: "#2B579A",
            color: "#fff",
            fontFamily: FONTS.mono,
            fontSize: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          W
        </span>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 28,
            color: COLORS.brownDeep,
          }}
        >
          {fileName}
        </span>
      </div>
      <Tap x={763} y={1565} atFrame={SUBMIT_TAP} />
    </ShotCamera>
  );
};

/** Part B: the processing log fills in step by step (admin-document.png, 3200 x 6612). */
const Processing: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <ShotCamera
      src="shots/admin-document.png"
      imageWidth={3200}
      imageHeight={6612}
      viewportWidth={FRAME_W}
      viewportHeight={VIEW_H}
      keys={[
        { frame: SPLIT, cx: 1985, cy: 780, scale: 0.84 },
        { frame: SPLIT + 100, cx: 1985, cy: 760, scale: 0.9 },
      ]}
    >
      {STEP_ROWS.map((y: number, i: number) => {
        const t = progress(frame, STEP_START + i * STEP_GAP, 10);
        return (
          <div
            key={y}
            style={{
              position: "absolute",
              left: 1180,
              top: y - 32,
              width: 1620,
              height: 64,
              backgroundColor: "#FFFFFF",
              opacity: 1 - t,
            }}
          />
        );
      })}
    </ShotCamera>
  );
};

/** Sound effects, in frames from the scene start. */
export const UPLOAD_SFX: readonly SceneSfx[] = [
  { at: DROP, sound: "page-turn", volume: 0.5 },
  { at: SUBMIT_TAP, sound: "mouse-click", volume: 0.6 },
  ...STEP_ROWS.map(
    (_: number, i: number): SceneSfx => ({
      at: STEP_START + i * STEP_GAP,
      sound: "switch",
      volume: 0.3,
    }),
  ),
];

/** The admin uploads the manual (Word, PDF or a scan) and processing starts. */
export const Upload: React.FC<Props> = ({
  fileName,
  caption,
  captionHighlight,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 0, 28);
  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          left: (1920 - FRAME_W) / 2,
          top: 150,
          opacity: enter,
          transform: `perspective(2200px) rotateX(${(1 - enter) * 16}deg) translateY(${(1 - enter) * 100}px)`,
        }}
      >
        <BrowserFrame
          width={FRAME_W}
          height={FRAME_H}
          url="hungerlearn.app/admin"
        >
          {frame < SPLIT ? <UploadForm fileName={fileName} /> : <Processing />}
        </BrowserFrame>
      </div>
      <ChapterChip index={chapter.index} label={chapter.label} />
      {frame >= SPLIT + 10 ? (
        <div
          style={{ position: "absolute", left: 120, right: 120, bottom: 46 }}
        >
          <Caption
            text={caption}
            highlight={captionHighlight}
            startFrame={SPLIT + 10}
            fontSize={54}
            align="center"
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
