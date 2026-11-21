import React, { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, ReceiptText, X } from "lucide-react";
import { adminAPI } from "@food/api";
import { Badge, Card, Empty, btn, errMsg, inputCls, inr2, when } from "./ui";

const STATUS = {
  claimed_from_admin: ["pending", "Waiting"],
  approved_by_admin: ["approved", "Paid back"],
  processed: ["approved", "Paid back"],
  rejected: ["rejected", "Rejected"],
  cancelled: ["not_required", "Withdrawn"],
  pending: ["pending", "Old (not filed)"],
};
const PAID_VIA = { upi: "UPI", bank: "Bank transfer", cash: "Cash" };

/**
 * Super admin: a franchise's refund claims (money it refunded customers itself).
 * Approving credits the franchise wallet once; the server re-checks the amount against
 * the order first. Rejecting needs a note the partner will see.
 */
export default function FranchiseRefundClaimsPanel({ app, onChanged }) {
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const claims = [...(app.refundRequests || [])]
    .sort((a, b) => new Date(b.claimedAt || b.requestedTime) - new Date(a.claimedAt || a.requestedTime));

  const decide = async (c, decision) => {
    const adminNote = (notes[c.id] || "").trim();
    if (decision === "reject" && adminNote.length < 3) {
      toast.error("Write a reason for the partner first");
      return;
    }
    setBusy(`${c.id}:${decision}`);
    try {
      await adminAPI.decideFranchiseRefundClaim(app._id, c.id, { decision, adminNote });
      toast.success(decision === "approve" ? `${inr2(c.amount)} added to the franchise wallet` : "Claim rejected");
      onChanged?.();
    } catch (err) {
      toast.error(errMsg(err));
      onChanged?.();
    } finally {
      setBusy("");
    }
  };

  return (
    <Card title={`Refund claims (${claims.length})`} icon={ReceiptText}>
      {!claims.length ? <Empty icon={ReceiptText}>No refund claims yet.</Empty> : (
        <div className="space-y-3">
          {claims.map((c) => {
            const [tone, label] = STATUS[c.status] || ["pending", c.status];
            const waiting = c.status === "claimed_from_admin";
            return (
              <div key={c.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-extrabold text-sm">#{c.orderId} <span className="font-semibold text-slate-500">· {c.merchantName || "-"}</span></div>
                  <div className="flex items-center gap-2"><span className="font-black text-sm">{inr2(c.amount)}</span><Badge status={tone}>{label}</Badge></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div><span className="text-slate-400 font-bold uppercase text-[10px]">Paid via</span><div className="font-semibold">{PAID_VIA[c.paidVia] || c.method || "-"}</div></div>
                  <div><span className="text-slate-400 font-bold uppercase text-[10px]">Reference</span><div className="font-mono font-semibold">{c.paymentReference || "-"}</div></div>
                </div>
                <div className="p-2.5 bg-white rounded-lg border border-slate-200">{c.reason || c.claimReason}</div>
                <div className="text-[10px] text-slate-400">Filed {when(c.claimedAt || c.requestedTime)}{c.decidedAt ? ` · decided ${when(c.decidedAt)}` : ""}</div>
                {waiting ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600">Check the reference in the partner's statement before approving. Approving adds the amount to their wallet.</p>
                    <input className={inputCls} placeholder="Note for the partner (required to reject)" value={notes[c.id] || ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
                    <div className="flex gap-2">
                      <button className={btn.success} disabled={Boolean(busy)} onClick={() => decide(c, "approve")}>
                        {busy === `${c.id}:approve` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve and pay back
                      </button>
                      <button className={btn.ghost} disabled={Boolean(busy)} onClick={() => decide(c, "reject")}>
                        {busy === `${c.id}:reject` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Reject
                      </button>
                    </div>
                  </div>
                ) : c.adminNote ? <div className="text-slate-700"><b>Note:</b> {c.adminNote}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
