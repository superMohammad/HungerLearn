# Loop 8 — assessment cases solved from the cited SOP before comparing with gold

Method: the scenario and the cited document's full rule list were read without `correct_action`,
`supporting_clause_ids`, or the wrong answer. Limitation: the solver had seen these gold answers earlier in the
same session (architecture review), so this is a careful re-derivation, not a blind test.

| Case | Answer derived from the SOP | Gold before | Problem | Fix |
| --- | --- | --- | --- | --- |
| A-C1 (courier v2, Arabic) | CW-02 v2: send «تأخر الاستلام» to dispatch | Same | Scenario at exactly 10 min, the new threshold: reading «بعد 10 دقائق» as strict gives "wait" | Scenario moved to 12 min: v2 says report, v1 (١٥) says wait, so the case tests the update |
| A-C2 (courier, English) | CH-02 ticket with Dispatch, not marked delivered; CH-03 forbids the door drop | Same | On the 6-min boundary; wrong answer breaks CH-03 too but remediation only `training-ch-02` | Seven minutes; remediation `training-ch-02` + `training-ch-03`; explanation names both rules |
| A-E1 (employee v2, English) | ED-02 v2: route to the duty lead, who pages dispatch | Same | Asked "Who should act next?" while the key is an action (literal answer: the support agent) | Asks what the support agent should do; kept at 8 min and marked `threshold_boundary` to stay aligned with the video-demo late-order lesson |
| A-E2 (employee, Arabic) | EC-02: 24-hour follow-up, no refund of the pending charge | Same | None | `violates: [EC-02]` added |
| A-P1 (partner v2, Arabic) | PP-02 v2: outer bag, seal the outer bag | Same | None | `violates: [PP-02]` added |
| A-P2 (partner, English) | PS-10 hold stock, PS-02 offer in the order screen, pack only after approval | Partial | "has yet to approve it" leaves open whether the offer was already sent (then the answer is "wait"); key omitted the PS-10 hold | Scenario states the offer has not been sent; key includes the hold; supporting `[PS-02, PS-10]` |
