import type React from "react";
import { Composition } from "remotion";
import { DemoVideo, TOTAL_FRAMES_60 } from "./DemoVideo";
import { DemoVideo90, TOTAL_FRAMES_90 } from "./DemoVideo90";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HungerLearnDemo"
        component={DemoVideo}
        durationInFrames={TOTAL_FRAMES_60}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          tagline: "من دليل الإجراءات إلى فريق جاهز",
          problemLines: [
            {
              text: "مستندات الإجراءات تتحدّث باستمرار",
              highlight: ["تتحدّث", "باستمرار"],
              start: 22,
              end: 74,
            },
            {
              text: "وكل تحديث يحتاج إعادة تدريب",
              highlight: ["إعادة", "تدريب"],
              start: 76,
              end: 124,
            },
            {
              text: "من يدرّب الفريق… ومن يتأكد أنهم فهموا؟",
              highlight: ["يدرّب", "يتأكد"],
              start: 126,
              end: 186,
            },
          ],
          understandCaption: "كل قاعدة مربوطة بنصّها الأصلي… حرفياً",
          understandHighlight: ["حرفياً"],
          checks: [
            "الاقتباس مطابق للمصدر حرفياً",
            "حَكَم آلي: لا قواعد مُختلَقة",
            "قواعد الصياغة والتنسيق",
          ],
          publishedLabel: "اعتُمد ونُشر للمتدربين",
          lessonText: {
            title: "شرح قصير بالفيديو",
            body: "مقاطع حقيقية ونصوص يولّدها النظام من البند نفسه",
          },
          practiceText: {
            title: "يتمرّن ويُختبر من جواله",
            body: "ويحدّد مدى ثقته في كل إجابة",
          },
          askQuestion: "من أجاب بثقة وكان مخطئاً؟",
          readinessCaption: "يكشف من أخطأ وهو واثق — قبل أن يخطئ في الميدان",
          readinessHighlight: ["واثق", "الميدان"],
          unchangedLabel: "بدون تغيير",
          movedLabel: "نُقل فقط",
          retrainLabel: "يُعاد تدريبه",
          v2Headline: "بند واحد تغيّر من 11",
          v2Subline: "فيُعاد توليد تدريبه وحده… والباقي يبقى معتمداً",
          stackNodes: [
            { title: "يقرأ الدليل", tech: "docproc · LangGraph" },
            { title: "يولّد ويتحقق", tech: "Gemma 4 · any API" },
            { title: "يحفظ ويطابق", tech: "Postgres · pgvector" },
          ],
          stackHeadline: "يعمل محلياً بالكامل",
          stackApiLine: "أو عبر أي مزوّد API تختاره",
          stackSpecs: "LOCAL MODELS · OR ANY OPENAI-COMPATIBLE API",
          team: ["Yasser Altayari", "Mohammed Albalawi", "Mohammed Almalke"],
        }}
      />
      <Composition
        id="HungerLearnDemo90"
        component={DemoVideo90}
        durationInFrames={TOTAL_FRAMES_90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          tagline: "من دليل الإجراءات إلى فريق جاهز",
          problemLines: [
            {
              text: "مستندات الإجراءات تتحدّث باستمرار",
              highlight: ["تتحدّث", "باستمرار"],
              start: 22,
              end: 74,
            },
            {
              text: "وكل تحديث يحتاج إعادة تدريب",
              highlight: ["إعادة", "تدريب"],
              start: 76,
              end: 124,
            },
            {
              text: "من يدرّب الفريق… ومن يتأكد أنهم فهموا؟",
              highlight: ["يدرّب", "يتأكد"],
              start: 126,
              end: 186,
            },
          ],
          understandCaption: "كل قاعدة مربوطة بنصّها الأصلي… حرفياً",
          understandHighlight: ["حرفياً"],
          checks: [
            "الاقتباس مطابق للمصدر حرفياً",
            "حَكَم آلي: لا قواعد مُختلَقة",
            "قواعد الصياغة والتنسيق",
          ],
          publishedLabel: "اعتُمد ونُشر للمتدربين",
          lessonText: {
            title: "شرح قصير بالفيديو",
            body: "مقاطع حقيقية ونصوص يولّدها النظام من البند نفسه",
          },
          practiceText: {
            title: "يتمرّن ويُختبر من جواله",
            body: "ويحدّد مدى ثقته في كل إجابة",
          },
          askQuestion: "من أجاب بثقة وكان مخطئاً؟",
          readinessCaption: "يكشف من أخطأ وهو واثق — قبل أن يخطئ في الميدان",
          readinessHighlight: ["واثق", "الميدان"],
          unchangedLabel: "بدون تغيير",
          movedLabel: "نُقل فقط",
          retrainLabel: "يُعاد تدريبه",
          v2Headline: "بند واحد تغيّر من 11",
          v2Subline: "فيُعاد توليد تدريبه وحده… والباقي يبقى معتمداً",
          stackNodes: [
            { title: "يقرأ الدليل", tech: "docproc · LangGraph" },
            { title: "يولّد ويتحقق", tech: "Gemma 4 · any API" },
            { title: "يحفظ ويطابق", tech: "Postgres · pgvector" },
          ],
          stackHeadline: "يعمل محلياً بالكامل",
          stackApiLine: "أو عبر أي مزوّد API تختاره",
          stackSpecs: "LOCAL MODELS · OR ANY OPENAI-COMPATIBLE API",
          uploadFileName: "courier-pickup-wait-v1-ar.docx",
          uploadCaption: "ارفع الدليل كما هو: Word أو PDF أو صورة ممسوحة",
          uploadHighlight: ["كما", "هو:"],
          rolesHeadline: "كل دور يتدرّب على إجراءاته",
          roles: [
            {
              photo: "photos/role-courier.webp",
              role: "مندوب توصيل",
              manual: "انتظار الاستلام في الفرع",
            },
            {
              photo: "photos/role-employee.webp",
              role: "موظف عمليات ودعم",
              manual: "مراجعة بلاغ خصم مكرر",
            },
            {
              photo: "photos/role-partner.webp",
              role: "شريك (مطعم أو مقهى)",
              manual: "تعبئة الطلبات وإغلاق الأكياس",
            },
          ],
          progressTitle: "شارة لكل إجراء يجتازه",
          progressBody: "ومستوى يُظهر مدى جاهزيته للعمل",
          dashboardCaption:
            "نسبة الاجتياز لكل إجراء وفرع… ومن يحتاج إعادة تدريب",
          dashboardHighlight: ["إعادة", "تدريب"],
          bilingualHeadline: "عربي أولاً… وإنجليزي بضغطة",
          bilingualBody: "واجهة كاملة باللغتين لكل الأدوار",
          team: ["Yasser Altayari", "Mohammed Albalawi", "Mohammed Almalke"],
        }}
      />
    </>
  );
};
