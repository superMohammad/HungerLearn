import type React from "react";
import { type Slot, Timeline, totalFrames } from "./components/Timeline";
import { Generate, GENERATE_SFX } from "./scenes/Generate";
import { Learn, LEARN_SFX } from "./scenes/Learn";
import { LocalStack, LOCAL_STACK_SFX } from "./scenes/LocalStack";
import { LogoIntro, LOGO_INTRO_SFX } from "./scenes/LogoIntro";
import { Outro, OUTRO_SFX } from "./scenes/Outro";
import { type Line, Problem, problemSfx } from "./scenes/Problem";
import { Readiness, READINESS_SFX } from "./scenes/Readiness";
import { Understand, understandSfx } from "./scenes/Understand";
import { VersionTwo, VERSION_TWO_SFX } from "./scenes/VersionTwo";

type TextBlock = { readonly title: string; readonly body: string };
type StackNode = { readonly title: string; readonly tech: string };

/** On-screen text shared by every cut of the demo. */
export type DemoVideoProps = {
  readonly tagline: string;
  readonly problemLines: readonly Line[];
  readonly understandCaption: string;
  readonly understandHighlight: readonly string[];
  readonly checks: readonly string[];
  readonly publishedLabel: string;
  readonly lessonText: TextBlock;
  readonly practiceText: TextBlock;
  readonly askQuestion: string;
  readonly readinessCaption: string;
  readonly readinessHighlight: readonly string[];
  readonly unchangedLabel: string;
  readonly movedLabel: string;
  readonly retrainLabel: string;
  readonly v2Headline: string;
  readonly v2Subline: string;
  readonly stackNodes: readonly StackNode[];
  readonly stackHeadline: string;
  readonly stackApiLine: string;
  readonly stackSpecs: string;
  readonly team: readonly string[];
};

/** Scene lengths of the 60 s cut (30 fps); total = 1797 frames (59.9 s, under the 60 s limit). */
const D = {
  intro: 150,
  problem: 188,
  understand: 278,
  generate: 218,
  learn: 308,
  readiness: 188,
  versionTwo: 278,
  local: 128,
  outro: 125,
} as const;

export const TOTAL_FRAMES_60: number = totalFrames(Object.values(D));

/** The 60-second judges' demo: logo → problem → five product chapters → local/API stack → outro. */
export const DemoVideo: React.FC<DemoVideoProps> = (p) => {
  const slots: readonly Slot[] = [
    {
      name: "Logo intro",
      duration: D.intro,
      sfx: LOGO_INTRO_SFX,
      content: (
        <LogoIntro footage="footage/CL-C03-do.mp4" tagline={p.tagline} />
      ),
    },
    {
      name: "Problem",
      duration: D.problem,
      sfx: problemSfx(p.problemLines),
      content: <Problem lines={p.problemLines} />,
    },
    {
      name: "01 Understand",
      duration: D.understand,
      sfx: understandSfx(0),
      content: (
        <Understand
          caption={p.understandCaption}
          captionHighlight={p.understandHighlight}
          focusHold={0}
          chapter={{ index: "01", label: "يقرأ الدليل بنداً بنداً" }}
        />
      ),
    },
    {
      name: "02 Generate",
      duration: D.generate,
      sfx: GENERATE_SFX,
      content: (
        <Generate
          checks={p.checks}
          publishedLabel={p.publishedLabel}
          chapter={{ index: "02", label: "يولّد التدريب ويتحقق منه" }}
        />
      ),
    },
    {
      name: "03 Learn",
      duration: D.learn,
      sfx: LEARN_SFX,
      content: (
        <Learn
          lessonText={p.lessonText}
          practiceText={p.practiceText}
          chapter={{ index: "03", label: "المتدرب يتعلّم من جواله" }}
        />
      ),
    },
    {
      name: "04 Readiness",
      duration: D.readiness,
      sfx: READINESS_SFX,
      content: (
        <Readiness
          question={p.askQuestion}
          caption={p.readinessCaption}
          captionHighlight={p.readinessHighlight}
          chapter={{ index: "04", label: "المشرف يعرف جاهزية فريقه" }}
        />
      ),
    },
    {
      name: "05 Version two",
      duration: D.versionTwo,
      sfx: VERSION_TWO_SFX,
      content: (
        <VersionTwo
          unchangedLabel={p.unchangedLabel}
          movedLabel={p.movedLabel}
          retrainLabel={p.retrainLabel}
          headline={p.v2Headline}
          subline={p.v2Subline}
          chapter={{ index: "05", label: "صدرت نسخة جديدة من الدليل" }}
        />
      ),
    },
    {
      name: "Local stack",
      duration: D.local,
      sfx: LOCAL_STACK_SFX,
      content: (
        <LocalStack
          nodes={p.stackNodes}
          headline={p.stackHeadline}
          apiLine={p.stackApiLine}
          specs={p.stackSpecs}
        />
      ),
    },
    {
      name: "Outro",
      duration: D.outro,
      sfx: OUTRO_SFX,
      content: (
        <Outro
          footage="footage/CL-P01-do.mp4"
          tagline={p.tagline}
          team={p.team}
        />
      ),
    },
  ];
  return <Timeline slots={slots} />;
};
