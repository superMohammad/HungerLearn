"""Authoring record for the clause-level change-detection fixtures (dev/gold and held_out/gold change_pairs.json).

Each pair starts from an exact gold clause quote ("before") and applies ONE typed edit to produce "after".
Edits are written as exact substring replacements (or a full replacement text) so the source text cannot drift.
The label comes from construction; validate.py then re-derives evidence from the text itself and rejects any
pair whose text does not support its label (e.g. a "wording" pair that changed a number).
All procedures are fictional training material, not HungerStation policy.

Run from the dataset directory:  python qa/change_pairs_authoring.py   (rewrites both change_pairs.json files)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SEVERITY = {"cosmetic": "none", "wording": "low", "order": "medium", "condition": "medium", "modality": "medium",
            "negation": "high", "actor": "high", "threshold": "high"}
HANDLING = {"cosmetic": "carry_forward", "wording": "refresh_text"}

CP = "courier-pickup-wait-v2"
CP1 = "courier-pickup-wait-v1"
CH = "courier-failed-handoff-v1"
ED = "employee-delayed-order-v2"
EC = "employee-duplicate-charge-v1"
PP = "partner-packing-sealing-v2"
PS = "partner-item-substitution-v1"
CD = "courier-damaged-package-v1"
EG = "employee-complaint-escalation-v1"
PV = "partner-counter-verification-v1"

# (pair_id, change_type, document_id, clause_id, edits | full "after" text, evidence, note)
DEV = [
    # threshold: only the number changes
    ("T01", "threshold", CP1, "CW-02", [("١٥ دقيقة", "٢٠ دقيقة")], {"before": "١٥", "after": "٢٠"}, "Pickup delay limit 15 -> 20 minutes (v1 text, Arabic-Indic digits)."),
    ("T02", "threshold", CP, "CW-02", [("10 دقائق", "5 دقائق")], {"before": "10", "after": "5"}, "Pickup delay limit 10 -> 5 minutes (v2 text, ASCII digits)."),
    ("T03", "threshold", EC, "EC-02", [("٢٤ ساعة", "٤٨ ساعة")], {"before": "٢٤", "after": "٤٨"}, "Follow-up window 24 -> 48 hours."),
    ("T04", "threshold", EC, "EC-02", [("٢٤ ساعة", "١٢ ساعة")], {"before": "٢٤", "after": "١٢"}, "Follow-up window 24 -> 12 hours."),
    ("T05", "threshold", CH, "CH-02", [("after 6 minutes", "after 4 minutes")], {"before": "6", "after": "4"}, "Handoff timer 6 -> 4 minutes."),
    ("T06", "threshold", CH, "CH-02", [("after 6 minutes", "after 10 minutes")], {"before": "6", "after": "10"}, "Handoff timer 6 -> 10 minutes."),
    ("T07", "threshold", ED, "ED-01", [("at least 12 minutes", "at least 15 minutes")], {"before": "12", "after": "15"}, "Delay-case trigger 12 -> 15 minutes."),
    ("T08", "threshold", ED, "ED-01", [("at least 12 minutes", "at least 10 minutes")], {"before": "12", "after": "10"}, "Delay-case trigger 12 -> 10 minutes."),
    ("T09", "threshold", ED, "ED-02", [("for 8 minutes", "for 5 minutes")], {"before": "8", "after": "5"}, "Stalled-tracking escalation 8 -> 5 minutes."),
    ("T10", "threshold", PS, "PS-03", [("7 minutes", "10 minutes")], {"before": "7", "after": "10"}, "Substitution answer window 7 -> 10 minutes."),
    # cosmetic: nothing a learner must do differently
    ("C01", "cosmetic", CP, "CW-02", [("بعد 10 دقائق", "بعد ١٠ دقائق")], {"kind": "digit_glyph"}, "Same value, Arabic-Indic instead of ASCII digits."),
    ("C02", "cosmetic", EC, "EC-02", [("٢٤ ساعة", "24 ساعة")], {"kind": "digit_glyph"}, "Same value, ASCII instead of Arabic-Indic digits."),
    ("C03", "cosmetic", CP, "CW-14", [("كيساً", "كِيساً")], {"kind": "diacritics"}, "Added a kasra."),
    ("C04", "cosmetic", CP, "CW-10", [("أبلغ مسؤول التوزيع", "أبلغ مسؤول التوزيـــع")], {"kind": "tatweel"}, "Added tatweel (kashida) stretching."),
    ("C05", "cosmetic", PP, "PP-13", [("على الطلب،", "على الطلب,")], {"kind": "punctuation"}, "Arabic comma replaced by a Latin comma."),
    ("C06", "cosmetic", PS, "PS-13", [("pending instructions.", "pending instructions")], {"kind": "punctuation"}, "Final period removed."),
    ("C07", "cosmetic", ED, "ED-10", [("customer's", "customer’s")], {"kind": "quotes"}, "Straight apostrophe replaced by a curly one."),
    ("C08", "cosmetic", CH, "CH-02", [("Failed Handoff ticket", "failed handoff ticket")], {"kind": "case"}, "Ticket name lower-cased."),
    ("C09", "cosmetic", CH, "CH-01", [("chat message. Start", "chat message.  Start")], {"kind": "whitespace"}, "Double space between sentences."),
    ("C10", "cosmetic", ED, "ED-11", [("from Dispatch and record", "from Dispatch, and record")], {"kind": "punctuation"}, "Comma added."),
    # negation: a prohibition added or removed
    ("N01", "negation", CH, "CH-02", [("with Dispatch. Do not mark the order delivered.", "with Dispatch and mark the order delivered.")], {"direction": "removed"}, "Courier now marks a failed handoff as delivered."),
    ("N02", "negation", PS, "PS-01", [("Do not suggest a replacement.", "Suggest a replacement anyway.")], {"direction": "removed"}, "No-substitution customers now get offers."),
    ("N03", "negation", CH, "CH-14", [("by phone and keep the order with you.", "by phone. Do not keep the order with you.")], {"direction": "added"}, "Courier no longer keeps the order during an app outage."),
    ("N04", "negation", ED, "ED-12", [("with the status history attached.", "without the status history attached.")], {"direction": "added"}, "Transfers drop the status history."),
    ("N05", "negation", PS, "PS-14", [("costs less, record the lower price in the order screen and leave", "costs less, do not record the lower price in the order screen; leave")], {"direction": "added"}, "Lower price is no longer recorded."),
    ("N06", "negation", ED, "ED-15", [("alert can be cleared.", "alert cannot be cleared.")], {"direction": "added"}, "Alert can no longer be cleared."),
    ("N07", "negation", CP, "CW-15", [("ولا تلغِ الطلب من حسابك", "وألغِ الطلب من حسابك")], {"direction": "removed"}, "Courier now cancels the order themselves."),
    ("N08", "negation", EC, "EC-13", [("ولا ترفع طلب استرداد ثانياً", "وارفع طلب استرداد ثانياً")], {"direction": "removed"}, "A second refund request is now raised."),
    ("N09", "negation", EC, "EC-14", [("ولا تطلب رقم البطاقة كاملاً", "واطلب رقم البطاقة كاملاً")], {"direction": "removed"}, "Full card number is now requested (privacy-relevant)."),
    ("N10", "negation", CP, "CW-14", [("اتركه عند نقطة الاستلام", "لا تتركه عند نقطة الاستلام")], {"direction": "added"}, "Wrong bag is no longer left at the counter."),
    ("N11", "negation", PP, "PP-12", [("داخل كيس منفصل", "دون كيس منفصل")], {"direction": "added"}, "Drink no longer goes in a separate bag."),
    # modality: obligation weakened (imperative/must -> may/should/optional)
    ("M01", "modality", ED, "ED-02", [("the support agent must route", "the support agent may route")], {"direction": "weakened"}, "Routing to the duty lead becomes optional."),
    ("M02", "modality", CH, "CH-11", [("note it in the order record and wait for Dispatch", "note it in the order record; you may wait for Dispatch")], {"direction": "weakened"}, "Waiting for route confirmation becomes optional."),
    ("M03", "modality", PS, "PS-15", "After packing an approved replacement, you should mark the preparation slip with the actual item and may retain the approval in the order record.", {"direction": "weakened"}, "Slip marking becomes a recommendation, retention optional."),
    ("M04", "modality", ED, "ED-16", [("When the timeline confirms delivery, send", "When the timeline confirms delivery, you may send")], {"direction": "weakened"}, "Closure message becomes optional."),
    ("M05", "modality", CH, "CH-16", [("add their reply to the ticket and follow the next instruction from Dispatch.", "add their reply to the ticket; following the next instruction from Dispatch is optional.")], {"direction": "weakened"}, "Following Dispatch becomes optional."),
    ("M06", "modality", CH, "CH-10", [("Stay outside the gate while waiting.", "You should stay outside the gate while waiting.")], {"direction": "weakened"}, "Staying outside becomes a recommendation."),
    ("M07", "modality", CP, "CW-11", [("تابع وقت الانتظار لكل طلب على حدة وسجّل وصولك", "يمكنك متابعة وقت الانتظار لكل طلب على حدة وتسجيل وصولك")], {"direction": "weakened"}, "Per-order tracking becomes optional."),
    ("M08", "modality", EC, "EC-10", [("حوّل التوقيتين إلى توقيت الفرع", "يُفضّل تحويل التوقيتين إلى توقيت الفرع")], {"direction": "weakened"}, "Time-zone conversion becomes a preference."),
    ("M09", "modality", PP, "PP-13", [("اعرضها على مشرف التحضير قبل الإغلاق وانتظر تأكيده", "يمكنك عرضها على مشرف التحضير قبل الإغلاق وانتظار تأكيده")], {"direction": "weakened"}, "Allergy check becomes optional (safety-critical)."),
    ("M10", "modality", EC, "EC-15", [("أحل الحالة إلى فريق", "يجوز أن تحيل الحالة إلى فريق")], {"direction": "weakened"}, "Referral becomes permitted rather than required."),
    ("M11", "modality", PP, "PP-16", [("واجعل ملصق الرقم ظاهراً من جهة الممر", "ويُفضّل أن يكون ملصق الرقم ظاهراً من جهة الممر")], {"direction": "weakened"}, "Label visibility becomes a preference."),
    # actor: the responsible person changes
    ("A01", "actor", ED, "ED-13", [("route it to the cancellations desk.", "route it to the duty lead.")], {"before": "cancellations desk", "after": "duty lead"}, "Cancellation requests go to the duty lead."),
    ("A02", "actor", CH, "CH-15", [("give the order to the branch lead", "give the order to the restaurant cashier")], {"before": "branch lead", "after": "restaurant cashier"}, "Returns handed to the cashier."),
    ("A03", "actor", ED, "ED-11", [("request the last confirmed status from Dispatch", "request the last confirmed status from the duty lead")], {"before": "dispatch", "after": "duty lead"}, "Status requested from the duty lead."),
    ("A04", "actor", PS, "PS-12", [("send Partner Support the rejection", "send the branch manager the rejection")], {"before": "partner support", "after": "branch manager"}, "Rejection goes to the branch manager."),
    ("A05", "actor", CH, "CH-13", [("unless the app authorizes that drop-off", "unless Dispatch authorizes that drop-off")], {"before": "app", "after": "dispatch"}, "Dispatch, not the app, authorizes lobby drops."),
    ("A06", "actor", CP, "CW-10", [("أبلغ مسؤول التوزيع بوقت وصولك", "أبلغ موظف الفرع بوقت وصولك")], {"before": "مسؤول التوزيع", "after": "موظف الفرع"}, "Arrival time reported to branch staff."),
    ("A07", "actor", CP, "CW-13", [("اطلب من موظف الفرع تحديد مكانه", "اطلب من مسؤول التوزيع تحديد مكانه")], {"before": "موظف الفرع", "after": "مسؤول التوزيع"}, "Dispatch locates the order."),
    ("A08", "actor", EC, "EC-16", [("وأحل الحالة إلى مراجع المدفوعات", "وأحل الحالة إلى فريق تسوية الطلبات")], {"before": "مراجع المدفوعات", "after": "فريق تسوية الطلبات"}, "Currency cases go to reconciliation."),
    ("A09", "actor", PP, "PP-14", [("أبلغ المشرف إذا تضررت", "أبلغ المندوب إذا تضررت")], {"before": "المشرف", "after": "المندوب"}, "Courier, not the supervisor, is told about damage."),
    ("A10", "actor", PP, "PP-15", [("الظاهر لموظف نقطة الاستلام", "الظاهر للمندوب")], {"before": "موظف نقطة الاستلام", "after": "المندوب"}, "Label faces the courier."),
    # condition: an exception or trigger condition added, removed or broadened
    ("K01", "condition", CH, "CH-03", [("Leave at Door and the app accepts a proof photo.", "Leave at Door or if the app accepts a proof photo.")], {"direction": "added"}, "Door drop allowed on either condition."),
    ("K02", "condition", PS, "PS-11", [("offer a replacement only when you can supply the full requested quantity at the allowed price.", "offer a replacement for whatever quantity you can supply at the allowed price.")], {"direction": "removed"}, "Full-quantity condition dropped."),
    ("K03", "condition", ED, "ED-10", [("and keep its original opening time.", "and keep its original opening time unless the customer reports a new delivery address.")], {"direction": "added"}, "New exception for address changes."),
    ("K04", "condition", CH, "CH-12", [("hand it over only when the app lists that person as an alternate recipient.", "hand it over when the app lists that person as an alternate recipient or when they show the order number.")], {"direction": "added"}, "Handover allowed on order number alone."),
    ("K05", "condition", PS, "PS-16", [("is cancelled while an offer is pending, release", "is cancelled, release")], {"direction": "removed"}, "Applies to every cancellation."),
    ("K06", "condition", CP, "CW-12", "إذا وجدت مدخل الخدمة مغلقاً، اسأل موظف الاستقبال عن نقطة الاستلام المخصصة للمندوبين إلا إذا كان المدخل العام مغلقاً أيضاً.", {"direction": "added"}, "Public-entrance condition becomes an exception."),
    ("K07", "condition", EC, "EC-12", [("ولا تسجّلها خصماً مكتملاً.", "ولا تسجّلها خصماً مكتملاً إلا إذا أكد العميل الخصم في كشف حسابه.")], {"direction": "added"}, "Customer statement overrides the decline."),
    ("K08", "condition", PP, "PP-11", [("ضع كل مجموعة في كيس مستقل وألصق", "ضع كل مجموعة في كيس مستقل ما لم يطلب العميل كيساً واحداً، وألصق")], {"direction": "added"}, "Customer can request a single bag."),
    ("K09", "condition", EC, "EC-11", [("وأغلق البلاغ الثاني بوصفه مكرراً.", "وأغلق البلاغ الثاني بوصفه مكرراً إلا إذا كان البلاغ الأول مغلقاً.")], {"direction": "added"}, "Closed first report changes the merge."),
    ("K10", "condition", PP, "PP-10", [("أعد الطلب الناقص إلى محطة التحضير لاستكماله.", "أعد الطلب الناقص إلى محطة التحضير لاستكماله إذا كان الصنف الناقص متوفراً.")], {"direction": "added"}, "Return only when the item is in stock."),
    # order: the sequence of steps changes
    ("O01", "order", ED, "ED-01", "When the displayed delivery estimate is at least 12 minutes past, record the order ID and last status timestamp, then open a Delay case.", {}, "Record before opening the case."),
    ("O02", "order", CH, "CH-01", [("Start the handoff timer after sending the message.", "Start the handoff timer before sending the message.")], {}, "Timer starts earlier."),
    ("O03", "order", PS, "PS-02", [("Pack it only after the customer approves it there.", "Pack it before the customer approves it there.")], {}, "Packing moves before approval."),
    ("O04", "order", CH, "CH-15", "If Dispatch directs a return, record the branch's receipt code in the Failed Handoff ticket before you give the order to the branch lead.", {}, "Receipt code recorded before handover."),
    ("O05", "order", ED, "ED-16", "When the timeline confirms delivery, close the case, then send the customer a closure message and record the confirmation time.", {}, "Case closed before messaging."),
    ("O06", "order", CP, "CW-01", "سجّل رقم الطلب، مثل TF-418، ووقت الوصول، ثم ابدأ حساب الانتظار عند اختيار «وصلت إلى الفرع» في التطبيق.", {}, "Logging moves before the timer start."),
    ("O07", "order", PP, "PP-01", [("مع شاشة التجهيز قبل الإغلاق", "مع شاشة التجهيز بعد الإغلاق")], {}, "Label check moves after sealing."),
    ("O08", "order", PP, "PP-14", [("واستبدل الكيس قبل الختم", "واستبدل الكيس بعد الختم")], {}, "Bag replaced after sealing."),
    ("O09", "order", CP, "CW-13", [("قبل تحديث حالته", "بعد تحديث حالته")], {}, "Status updated before locating."),
    ("O10", "order", PP, "PP-12", [("وتأكد من إحكام الغطاء قبل الإغلاق", "وتأكد من إحكام الغطاء بعد الإغلاق")], {}, "Lid checked after closing."),
    # wording: same meaning, different words
    ("W01", "wording", ED, "ED-14", [("keep a case for each order and add the shared incident ID to each case", "keep a separate case per order and add the shared incident ID to every case")], {}, "Paraphrase."),
    ("W02", "wording", CH, "CH-10", [("ask the customer for access through the order chat.", "use the order chat to ask the customer for access.")], {}, "Paraphrase."),
    ("W03", "wording", PS, "PS-10", [("check available stock and tell the prep station", "check the stock on hand and ask the prep station")], {}, "Paraphrase."),
    ("W04", "wording", ED, "ED-12", [("transfer the existing case to that queue with the status history attached.", "move the existing case to that queue and attach the status history.")], {}, "Paraphrase."),
    ("W05", "wording", CH, "CH-16", [("add their reply to the ticket and follow the next instruction from Dispatch.", "add the reply to that ticket and follow Dispatch's next instruction.")], {}, "Paraphrase."),
    ("W06", "wording", CP, "CW-11", [("تابع وقت الانتظار لكل طلب على حدة", "تابع وقت انتظار كل طلب بشكل منفصل")], {}, "Paraphrase."),
    ("W07", "wording", CP, "CW-03", [("إذا وجدت نقطة الاستلام مغلقة، اتصل بمسؤول التوزيع فوراً", "إذا كانت نقطة الاستلام مغلقة، اتصل بمسؤول التوزيع على الفور")], {}, "Paraphrase."),
    ("W08", "wording", EC, "EC-14", [("إذا غاب رقم العملية عن البلاغ، اطلب المرجع الظاهر في الإيصال", "إذا خلا البلاغ من رقم العملية، اطلب المرجع المطبوع على الإيصال")], {}, "Paraphrase."),
    ("W09", "wording", PP, "PP-15", [("إذا احتوى الكيس على عبوة هشة، ألصق علامة المناولة على وجه الكيس الظاهر", "إذا كان في الكيس عبوة هشة، ضع علامة المناولة على وجه الكيس المواجه")], {}, "Paraphrase."),
    ("W10", "wording", EC, "EC-15", [("إذا أظهر السجل دفعة نقدية وأخرى إلكترونية للطلب نفسه، أحل الحالة إلى فريق تسوية الطلبات مع الإيصالين.", "إذا بيّن السجل دفعة نقدية ودفعة إلكترونية للطلب ذاته، أحل الحالة إلى فريق تسوية الطلبات مرفقاً الإيصالين.")], {}, "Paraphrase."),
]

HELD_OUT = [
    ("T01", "threshold", CD, "CD-02", [("خلال ٤ دقائق", "خلال ٣ دقائق")], {"before": "٤", "after": "٣"}, "Photo deadline 4 -> 3 minutes."),
    ("T02", "threshold", EG, "EG-02", [("within 5 minutes", "within 10 minutes")], {"before": "5", "after": "10"}, "Urgent routing 5 -> 10 minutes."),
    ("T03", "threshold", PV, "PV-01", [("من ٤ أرقام", "من ٦ أرقام")], {"before": "٤", "after": "٦"}, "Pickup code 4 -> 6 digits."),
    ("C01", "cosmetic", CD, "CD-02", [("٤ دقائق", "4 دقائق")], {"kind": "digit_glyph"}, "Same value, ASCII digits."),
    ("C02", "cosmetic", EG, "EG-02", [("mark the case Urgent", "mark the case urgent")], {"kind": "case"}, "Lower-cased status name."),
    ("C03", "cosmetic", PV, "PV-16", [("«تم الاستلام»", "\"تم الاستلام\"")], {"kind": "quotes"}, "Guillemets replaced by straight quotes."),
    ("N01", "negation", CD, "CD-16", [("وأبقِ حالة التسليم كما هي", "ولا تُبقِ حالة التسليم كما هي")], {"direction": "added"}, "Delivery status is no longer kept."),
    ("N02", "negation", EG, "EG-03", [("Do not contact the courier from the case.", "Contact the courier from the case.")], {"direction": "removed"}, "Agent now contacts the courier."),
    ("N03", "negation", PV, "PV-02", [("لا تسلّم الطلب بناءً على اسم العميل وحده.", "سلّم الطلب بناءً على اسم العميل وحده.")], {"direction": "removed"}, "Handover on the customer name alone."),
    ("M01", "modality", EG, "EG-15", [("record their preferred time and assign the callback", "record their preferred time and you may assign the callback")], {"direction": "weakened"}, "Callback assignment becomes optional."),
    ("M02", "modality", PV, "PV-10", [("طابق عدد الأكياس", "يُفضّل أن تطابق عدد الأكياس")], {"direction": "weakened"}, "Bag-count check becomes a preference."),
    ("M03", "modality", CD, "CD-12", [("أعد تصوير موضع التلف", "يمكنك إعادة تصوير موضع التلف")], {"direction": "weakened"}, "Privacy retake becomes optional."),
    ("A01", "actor", EG, "EG-14", [("notify the on-call backup", "notify the duty lead")], {"before": "on-call backup", "after": "duty lead"}, "Duty lead replaces the backup."),
    ("A02", "actor", PV, "PV-13", [("واطلب الرمز من المندوب المعيّن حالياً", "واطلب الرمز من مشرف الفرع")], {"before": "المندوب", "after": "مشرف الفرع"}, "Supervisor supplies the code."),
    ("A03", "actor", CD, "CD-15", [("سلّمه لمشرف الفرع", "سلّمه لموظف الاستقبال")], {"before": "مشرف الفرع", "after": "موظف الاستقبال"}, "Returns go to reception."),
    ("K01", "condition", CD, "CD-03", [("وتابع التوصيل.", "وتابع التوصيل ما لم يطلب العميل فحص الطرد.")], {"direction": "added"}, "Customer inspection exception."),
    ("K02", "condition", EG, "EG-10", [("record that the name was withheld.", "record that the name was withheld unless the order ID is missing.")], {"direction": "added"}, "Exception when no order ID."),
    ("K03", "condition", PV, "PV-14", [("وسجّل رقم الطلب في قائمة الانتظار.", "وسجّل رقم الطلب في قائمة الانتظار إلا إذا كان الطلب سيجهز خلال دقائق.")], {"direction": "added"}, "Exception for nearly ready orders."),
    ("O01", "order", EG, "EG-13", [("before sharing it with the queue", "after sharing it with the queue")], {}, "Masking moves after sharing."),
    ("O02", "order", EG, "EG-16", "After the assigned queue records its decision, log the outcome, close the complaint, and then send the approved response.", {}, "Close before responding."),
    ("O03", "order", PV, "PV-15", [("بعد أن يتسلم المندوب", "قبل أن يتسلم المندوب")], {}, "Status updated before handover."),
    ("W01", "wording", CD, "CD-10", [("إذا كان الطلب موزعاً على أكثر من كيس، سجّل رمز الكيس المتضرر في البلاغ وبيّن أي الأكياس بقي سليماً.", "إذا توزع الطلب على عدة أكياس، سجّل رمز الكيس المتضرر في البلاغ ووضّح الأكياس التي بقيت سليمة.")], {}, "Paraphrase."),
    ("W02", "wording", EG, "EG-11", [("and preserve its opening time.", "and keep its opening time unchanged.")], {}, "Paraphrase."),
    ("W03", "wording", PV, "PV-12", [("إذا ظهر الرمز نفسه على طلبين في الشاشة، أوقف تسليمهما", "إذا ظهر رمز واحد على طلبين في الشاشة، أوقف تسليم الطلبين")], {}, "Paraphrase."),
]

SAFETY = {("partner-packing-sealing-v2", "PP-13")}  # allergy confirmation


def build(split, spec):
    docs = {d["document_id"]: d for d in json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["documents"]}
    quotes = {(r["document_id"], c["clause_id"]): c["quote"]
              for r in json.loads((ROOT / split / "gold" / "extraction.json").read_text(encoding="utf-8")) for c in r["clauses"]}
    pairs = []
    for pid, ctype, doc_id, cid, edit, evidence, note in spec:
        before = quotes[(doc_id, cid)]
        if isinstance(edit, str):
            after = edit
        else:
            after = before
            for old, new in edit:
                assert after.count(old) == 1, f"{split} {pid}: {old!r} occurs {after.count(old)} times"
                after = after.replace(old, new)
        safety = (doc_id, cid) in SAFETY
        severity = "high" if safety and ctype not in ("cosmetic", "wording") else SEVERITY[ctype]
        pairs.append({
            "pair_id": f"CP-{'DEV' if split == 'dev' else 'HO'}-{pid}",
            "language": docs[doc_id]["language"],
            "role": docs[doc_id]["role"],
            "base": {"document_id": doc_id, "clause_id": cid},
            "before": before,
            "after": after,
            "change_type": ctype,
            "material": ctype not in ("cosmetic", "wording"),
            "safety_tag": safety,
            "severity": severity,
            "expected_handling": HANDLING.get(ctype, "regenerate_and_reassess"),
            "evidence": evidence,
            "note": note,
        })
    out = ROOT / split / "gold" / "change_pairs.json"
    out.write_bytes((json.dumps(pairs, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n").encode("utf-8"))
    print(f"{split}: {len(pairs)} change pairs -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    build("dev", DEV)
    build("held_out", HELD_OUT)
