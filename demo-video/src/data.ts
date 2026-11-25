/**
 * Real content of the demo SOP "courier-pickup-wait" (data/synthetic_sops/dev/uploads),
 * v1 and v2. Only clause 2 changes in v2 (15 -> 10 minutes); clause 4 moves to a renamed section.
 */
export type SopClause = {
  readonly number: string;
  readonly headingV1: string;
  readonly headingV2: string;
  readonly text: string;
  readonly change: "unchanged" | "moved" | "changed";
};

export const SOP_TITLE = "انتظار استلام الطلب من الفرع";

export const CLAUSE_2_V1 =
  "إذا بقي الطلب قيد التجهيز بعد ١٥ دقيقة من تسجيل الوصول، أرسل بلاغ «تأخر الاستلام» إلى مسؤول التوزيع.";

export const CLAUSES: readonly SopClause[] = [
  {
    number: "١",
    headingV1: "عند الوصول",
    headingV2: "عند الوصول",
    text: "ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق. سجّل رقم الطلب، مثل TF-418، ووقت الوصول.",
    change: "unchanged",
  },
  {
    number: "٢",
    headingV1: "تأخر التجهيز",
    headingV2: "تأخر التجهيز",
    text: CLAUSE_2_V1,
    change: "changed",
  },
  {
    number: "٣",
    headingV1: "إغلاق نقطة الاستلام",
    headingV2: "إغلاق نقطة الاستلام",
    text: "إذا وجدت نقطة الاستلام مغلقة، اتصل بمسؤول التوزيع فوراً ولا تنتظر انتهاء المهلة.",
    change: "unchanged",
  },
  {
    number: "٤",
    headingV1: "قبل المغادرة",
    headingV2: "إنهاء الانتظار",
    text: "لا تغادر الفرع حتى يوجّهك مسؤول التوزيع بالمغادرة أو يسلّمك موظف الفرع الطلب.",
    change: "moved",
  },
  {
    number: "٥",
    headingV1: "تعذّر تسجيل الوصول",
    headingV2: "تعذّر تسجيل الوصول",
    text: "",
    change: "unchanged",
  },
  {
    number: "٦",
    headingV1: "استلام أكثر من طلب",
    headingV2: "استلام أكثر من طلب",
    text: "",
    change: "unchanged",
  },
  {
    number: "٧",
    headingV1: "الدخول من الباب الصحيح",
    headingV2: "الدخول من الباب الصحيح",
    text: "",
    change: "unchanged",
  },
  {
    number: "٨",
    headingV1: "طلب معلّم بأنه جاهز",
    headingV2: "طلب معلّم بأنه جاهز",
    text: "",
    change: "unchanged",
  },
  {
    number: "٩",
    headingV1: "اختلاف ملصق الاستلام",
    headingV2: "اختلاف ملصق الاستلام",
    text: "",
    change: "unchanged",
  },
  {
    number: "١٠",
    headingV1: "طلب الإلغاء من الفرع",
    headingV2: "طلب الإلغاء من الفرع",
    text: "",
    change: "unchanged",
  },
  {
    number: "١١",
    headingV1: "إغلاق بلاغ الانتظار",
    headingV2: "إغلاق بلاغ الانتظار",
    text: "",
    change: "unchanged",
  },
];

/** Hash shown by the app for clause 2 (first 8 hex chars of its content hash). */
export const CLAUSE_2_HASH = "ba329c59";
