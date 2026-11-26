"""Loop 4 authoring record: normalized `facts` written from each clause's source quote.

These replace trigger/action fields that had been copied verbatim (sometimes in Arabic) from the quote.
negation / exceptions / actor / exception_to are added only where the quote states them.
Apply with: python qa/facts_authoring.py   (idempotent; rewrites the matching clauses in both extraction files)
"""
import json
import sys
from pathlib import Path

F = {
    # courier-pickup-wait (v1, v2, v1 scan)
    "CW-10": dict(trigger="app check-in fails", action="tell dispatch the actual arrival time and ask them to log it in the report", exception_to="CW-01"),
    "CW-11": dict(trigger="several orders assigned from the same branch", action="track the wait separately for each order and check in for every open order"),
    "CW-12": dict(trigger="service entrance closed while the public entrance is open", action="ask reception where the courier pickup point is"),
    "CW-13": dict(trigger="order shows ready but is missing from the pickup shelf", action="have branch staff locate it by order number before its status is updated"),
    "CW-14": dict(trigger="staff offer a bag with a different order number", action="leave that bag at the pickup point and ask for the matching bag"),
    "CW-15": dict(trigger="branch staff ask the courier to cancel the order while waiting", action="relay the reason to dispatch", negation="do not cancel the order from the courier account"),
    "CW-16": dict(trigger="collecting an order that already has a delay report", action="record the pickup time in that same report", actor="dispatch closes the report"),
    # courier-failed-handoff
    "CH-10": dict(trigger="locked gate blocks the listed address", action="request access from the customer in the order chat and wait outside the gate"),
    "CH-11": dict(trigger="customer sends a different address in chat", action="note the new address in the order record and wait for dispatch to confirm the route", negation="do not move before dispatch confirms the route"),
    "CH-12": dict(trigger="someone other than the customer offers to take the order", action="hand over only to a person the app lists as an alternate recipient"),
    "CH-13": dict(trigger="building staff ask for a lobby drop", action="keep the order", exceptions=["app authorizes the lobby drop-off and accepts a proof photo"]),
    "CH-14": dict(trigger="app stops responding during handoff", action="phone dispatch with the order ID and contact attempts and keep the order"),
    "CH-15": dict(trigger="dispatch directs a return", action="give the order to the branch lead and log the branch receipt code in the Failed Handoff ticket"),
    "CH-16": dict(trigger="customer replies after a Failed Handoff ticket is opened", action="add the reply to the ticket and follow the next dispatch instruction"),
    # employee-delayed-order (v1, v2, v1 scan)
    "ED-10": dict(trigger="order already has an open Delay case", action="add the latest customer message to that case and keep its original opening time", exception_to="ED-01"),
    "ED-11": dict(trigger="order timeline shows no delivery estimate", action="request the last confirmed status from dispatch and record that no estimate is available"),
    "ED-12": dict(trigger="order belongs to another branch queue", action="transfer the existing case to that queue with its status history"),
    "ED-13": dict(trigger="customer asks to cancel a late order", action="link a Cancellation Request and send it to the cancellations desk"),
    "ED-14": dict(trigger="several late orders share one dispatch incident", action="keep one case per order and add the shared incident ID to every case"),
    "ED-15": dict(trigger="tracking resumes while a Delay case is open", action="record the new status and tell the case owner the stalled-tracking alert can be cleared"),
    "ED-16": dict(trigger="timeline confirms delivery", action="send a closure message and record the confirmation time before closing the case"),
    # employee-duplicate-charge
    "EC-10": dict(trigger="the two transactions show different time zones", action="convert both times to branch time before ordering events in the report"),
    "EC-11": dict(trigger="customer reports the same two transactions again", action="add the new message to the open report and close the second report as a duplicate"),
    "EC-12": dict(trigger="one transaction shows as declined", action="record the decline code", negation="do not record it as a completed charge"),
    "EC-13": dict(trigger="one transaction already has a completed refund", action="give the customer the refund reference number", negation="do not raise a second refund request"),
    "EC-14": dict(trigger="report lacks the transaction number", action="ask for the reference printed on the receipt", negation="do not ask for the full card number"),
    "EC-15": dict(trigger="one cash and one electronic payment for the same order", action="route the case to the order reconciliation team with both receipts"),
    "EC-16": dict(trigger="the two transactions are in different currencies", action="record both amounts as shown and route the case to the payments reviewer to check the conversion"),
    # partner-packing-sealing (v1, v2, v1 scan)
    "PP-10": dict(trigger="before closing a bag", action="check every item and quantity against the prep screen and send an incomplete order back to the prep station"),
    "PP-11": dict(trigger="order combines hot and cold items", action="pack each group in its own bag and label both bags with the order number"),
    "PP-12": dict(trigger="order includes a drink", action="secure the cup upright in a holder inside a separate bag and check the lid before closing"),
    "PP-13": dict(trigger="order carries an allergy note", action="show the note to the prep supervisor before closing and wait for their confirmation", actor="prep supervisor confirms the contents"),
    "PP-14": dict(trigger="bag gets wet during packing", action="inspect the inner containers, replace the bag before sealing, and tell the supervisor about any damaged container"),
    "PP-15": dict(trigger="bag holds a fragile container", action="put the handling label on the bag face that pickup staff can see"),
    "PP-16": dict(trigger="bags are sealed", action="place the order on the category shelf shown on the prep screen with its number label facing the aisle"),
    # partner-item-substitution
    "PS-10": dict(trigger="about to offer a replacement", action="check stock and have the prep station hold the quantity to be offered until the request is resolved"),
    "PS-16": dict(trigger="whole order cancelled while a substitution offer is pending", action="release the held stock and stop preparing the order"),
    "PS-11": dict(trigger="customer ordered several units", action="offer a replacement only if the full quantity is available at the allowed price"),
    "PS-12": dict(trigger="customer rejects the offer", action="mark the item unavailable and forward the recorded rejection to Partner Support"),
    "PS-13": dict(trigger="approved replacement sells out before packing", action="report it to Partner Support and leave the item unpacked until instructed"),
    "PS-14": dict(trigger="approved replacement costs less", action="record the lower price in the order screen", actor="Partner Support handles any payment adjustment"),
    "PS-15": dict(trigger="approved replacement has been packed", action="write the actual item on the preparation slip and keep the approval in the order record"),
    # held out: courier-damaged-package
    "CD-10": dict(trigger="order is split across several bags", action="record the damaged bag code in the report and state which bags are intact"),
    "CD-11": dict(trigger="label became unreadable from moisture", action="use the order number from the app and note in the report that the bag code is not visible"),
    "CD-12": dict(trigger="customer name or address appears in the damage photo", action="retake the photo from an angle that hides those details"),
    "CD-13": dict(trigger="customer asks to open a damaged parcel before handover", action="keep the parcel closed and ask dispatch for the next step"),
    "CD-14": dict(trigger="broken glass protrudes from the packaging", action="keep other people away and call dispatch to decide how the parcel is collected", negation="do not touch the glass"),
    "CD-15": dict(trigger="dispatch directs a return", action="hand the parcel to the branch supervisor and record the return receipt number in the report"),
    "CD-16": dict(trigger="customer reports damage after delivery was recorded", action="forward the report to dispatch and leave the delivery status unchanged"),
    # held out: employee-complaint-escalation
    "EG-10": dict(trigger="customer declines to give a name", action="file the complaint under the order ID and note that the name was withheld"),
    "EG-11": dict(trigger="customer calls again about the same incident", action="add the update to the original case and keep its opening time"),
    "EG-12": dict(trigger="customer offers a screenshot", action="send the upload link and attach the image in the complaint portal"),
    "EG-13": dict(trigger="screenshot shows an unrelated person's phone number", action="mask that number in the review copy before the queue sees it"),
    "EG-14": dict(trigger="Urgent case routed but the duty supervisor is unavailable", action="notify the on-call backup under the same case ID", exception_to="EG-02"),
    "EG-15": dict(trigger="customer asks for a callback", action="record the preferred time and assign the callback to the case owner"),
    "EG-16": dict(trigger="assigned queue has recorded its decision", action="record the outcome and send the approved reply, then close the complaint"),
    # held out: partner-counter-verification
    "PV-03": dict(trigger="branch screen is down", action="hand over only after the supervisor checks the code in the backup pickup log and records the handover time"),
    "PV-10": dict(trigger="one order shows more than one bag", action="match the displayed bag count with the prep record before starting handover"),
    "PV-11": dict(trigger="courier presents an order for another branch", action="point the courier to the branch name shown in the app and keep the bags in place"),
    "PV-12": dict(trigger="same code appears on two orders", action="stop both handovers and ask the supervisor to match them by order number and courier assignment"),
    "PV-13": dict(trigger="assigned courier changes before pickup", action="refresh the branch screen and take the code from the currently assigned courier"),
    "PV-14": dict(trigger="displayed order is not ready", action="ask the courier to wait outside the lane and add the order number to the waiting list"),
    "PV-15": dict(trigger="courier has received all matching bags", action="set the order status to Picked up and record the courier's exit time"),
    "PV-16": dict(trigger="status shows Picked up while bags are still behind the counter", action="have the supervisor correct the status before any handover attempt"),
}

ORDER = ["responsible_role", "trigger", "action", "actor", "threshold", "negation", "exceptions", "exception_to"]
KEEP = ("responsible_role", "threshold", "exceptions", "actor", "negation", "exception_to")


def apply(root):
    for split in ("dev", "held_out"):
        path = root / split / "gold" / "extraction.json"
        rows = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for record in rows:
            for clause in record["clauses"]:
                if clause["clause_id"] not in F:
                    continue
                old = clause["facts"]
                new = {"responsible_role": old["responsible_role"], **F[clause["clause_id"]]}
                for key in KEEP:
                    if key in old and key not in new:
                        new[key] = old[key]
                clause["facts"] = {k: new[k] for k in ORDER if k in new}
                n += 1
        path.write_bytes((json.dumps(rows, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n").encode("utf-8"))
        print(f"{split}: {n} clause occurrences re-labelled")


if __name__ == "__main__":
    apply(Path(__file__).resolve().parents[1])
    sys.exit(0)
