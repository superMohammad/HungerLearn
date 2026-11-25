import type React from "react";
import { type Slot, Timeline, totalFrames } from "./components/Timeline";
import type { DemoVideoProps } from "./DemoVideo";
import { Bilingual, BILINGUAL_SFX } from "./scenes/Bilingual";
import { Dashboard, DASHBOARD_SFX } from "./scenes/Dashboard";
import { Generate, GENERATE_SFX } from "./scenes/Generate";
import { Learn, LEARN_SFX } from "./scenes/Learn";
import { LocalStack, LOCAL_STACK_SFX } from "./scenes/LocalStack";
import { LogoIntro, LOGO_INTRO_SFX } from "./scenes/LogoIntro";
import { Outro, OUTRO_SFX } from "./scenes/Outro";
import { Problem, problemSfx } from "./scenes/Problem";
import { Progress, PROGRESS_SFX } from "./scenes/Progress";
import { Readiness, READINESS_SFX } from "./scenes/Readiness";
import { Roles, ROLES_SFX } from "./scenes/Roles";
import { Understand, understandSfx } from "./scenes/Understand";
import { Upload, UPLOAD_SFX } from "./scenes/Upload";
import { VersionTwo, VERSION_TWO_SFX } from "./scenes/VersionTwo";

type Role = {
  readonly photo: string;
  readonly role: string;
  readonly manual: string;
};

/** The 90 s cut adds upload, roles, progress, dashboard and bilingual beats. */
export type DemoVideo90Props = DemoVideoProps & {
  readonly uploadFileName: string;
  readonly uploadCaption: string;
  readonly uploadHighlight: readonly string[];
  readonly rolesHeadline: string;
  readonly roles: readonly Role[];
  readonly progressTitle: string;
  readonly progressBody: string;
  readonly dashboardCaption: string;
  readonly dashboardHighlight: readonly string[];
  readonly bilingualHeadline: string;
  readonly bilingualBody: string;
};

/** Scene lengths of the 90 s cut (30 fps); total = 2697 frames (89.9 s, under the 90 s limit). */
const D = {
  intro: 160,
  problem: 190,
  upload: 200,
  understand: 330,
  generate: 225,
  roles: 150,
  learn: 320,
  progress: 140,
  dashboard: 170,
  readiness: 195,
  versionTwo: 285,
  bilingual: 146,
  local: 140,
  outro: 150,
} as const;

export const TOTAL_FRAMES_90: number = totalFrames(Object.values(D));

/** The 90-second judges' demo. */
export const DemoVideo90: React.FC<DemoVideo90Props> = (p) => {
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
      name: "01 Upload",
      duration: D.upload,
      sfx: UPLOAD_SFX,
      content: (
        <Upload
          fileName={p.uploadFileName}
          caption={p.uploadCaption}
          captionHighlight={p.uploadHighlight}
          chapter={{ index: "01", label: "يرفع الدليل كما هو" }}
        />
      ),
    },
    {
      name: "02 Understand",
      duration: D.understand,
      sfx: understandSfx(45),
      content: (
        <Understand
          caption={p.understandCaption}
          captionHighlight={p.understandHighlight}
          focusHold={45}
          chapter={{ index: "02", label: "يقرأ الدليل بنداً بنداً" }}
        />
      ),
    },
    {
      name: "03 Generate",
      duration: D.generate,
      sfx: GENERATE_SFX,
      content: (
        <Generate
          checks={p.checks}
          publishedLabel={p.publishedLabel}
          chapter={{ index: "03", label: "يولّد التدريب ويتحقق منه" }}
        />
      ),
    },
    {
      name: "Roles",
      duration: D.roles,
      sfx: ROLES_SFX,
      content: <Roles headline={p.rolesHeadline} roles={p.roles} />,
    },
    {
      name: "04 Learn",
      duration: D.learn,
      sfx: LEARN_SFX,
      content: (
        <Learn
          lessonText={p.lessonText}
          practiceText={p.practiceText}
          chapter={{ index: "04", label: "المتدرب يتعلّم من جواله" }}
        />
      ),
    },
    {
      name: "04 Progress",
      duration: D.progress,
      sfx: PROGRESS_SFX,
      content: (
        <Progress
          title={p.progressTitle}
          body={p.progressBody}
          chapter={{ index: "04", label: "المتدرب يتعلّم من جواله" }}
        />
      ),
    },
    {
      name: "05 Dashboard",
      duration: D.dashboard,
      sfx: DASHBOARD_SFX,
      content: (
        <Dashboard
          caption={p.dashboardCaption}
          captionHighlight={p.dashboardHighlight}
          chapter={{ index: "05", label: "المشرف يعرف جاهزية فريقه" }}
        />
      ),
    },
    {
      name: "05 Ask",
      duration: D.readiness,
      sfx: READINESS_SFX,
      content: (
        <Readiness
          question={p.askQuestion}
          caption={p.readinessCaption}
          captionHighlight={p.readinessHighlight}
          chapter={{ index: "05", label: "المشرف يعرف جاهزية فريقه" }}
        />
      ),
    },
    {
      name: "06 Version two",
      duration: D.versionTwo,
      sfx: VERSION_TWO_SFX,
      content: (
        <VersionTwo
          unchangedLabel={p.unchangedLabel}
          movedLabel={p.movedLabel}
          retrainLabel={p.retrainLabel}
          headline={p.v2Headline}
          subline={p.v2Subline}
          chapter={{ index: "06", label: "صدرت نسخة جديدة من الدليل" }}
        />
      ),
    },
    {
      name: "Bilingual",
      duration: D.bilingual,
      sfx: BILINGUAL_SFX,
      content: (
        <Bilingual headline={p.bilingualHeadline} body={p.bilingualBody} />
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
