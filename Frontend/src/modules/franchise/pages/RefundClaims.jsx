import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Info, Loader2, ReceiptText, Undo2, X } from "lucide-react";
import { franchiseApi } from "../api";
import {
  Badge, Card, Empty, ErrorState, Field, Loading, Modal, btn, errMsg, inputCls, inr2, isAmount, when,
} from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Table, useLoad } from "./common";

export const CLAIM_STATUS = {
  waiting: ["pending", "Waiting"],
  approved: ["approved", "Paid back"],
  rejected: ["rejected", "Rejected"],
  cancelled: ["not_required", "Withdrawn"],
};
const PAID_VIA = { upi: "UPI", bank: "Bank transfer", cash: "Cash" };

/** Money the franchise refunded to customers itself, claimed back from Raydo. */
export default function RefundClaims() {
  const list = useLoad(() => franchiseApi.refundClaims(), []);
  const [busy, setBusy] = useState("");

  const withdraw = async (id) => {
    setBusy(id);
    try {
      await franchiseApi.withdrawRefundClaim(id);
      toast.success("Claim withdrawn");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy("");
      list.reload();
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle title="Refund claims" sub="When you refund a customer yourself, claim the money back from Raydo here." onRefresh={list.reload} loading={list.loading} />
      <div className="flex items-start gap-2 p-4 rounded-2xl border border-blue-100 bg-blue-50 text-sm text-slate-700">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
        <span>
          To file a claim, open <Link to="/franchise/orders" className="font-bold text-blue-700 underline">Food orders</Link> and use <b>Claim refund</b> on a delivered or cancelled order from the last {list.data?.windowDays || 30} days.
          Raydo checks your payment reference and adds the money to your wallet.
        </span>
      </div>
      <Card title="Your claims" icon={ReceiptText}>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty icon={ReceiptText}>No refund claims yet.</Empty>
          : (
            <Table
              rows={list.data.items}
              columns={[
                { label: "Order", render: (c) => <div><div className="font-bold">#{c.orderCode}</div><div className="text-xs text-slate-500">{c.restaurantName}</div></div> },
                { label: "Amount", right: true, render: (c) => <span className="font-bold">{inr2(c.amount)}</span> },
                { label: "Paid by you", render: (c) => <span className="text-xs">{PAID_VIA[c.paidVia] || "-"}<span className="block font-mono text-slate-500">{c.paymentReference}</span></span> },
                { label: "Status", render: (c) => <Badge status={CLAIM_STATUS[c.status]?.[0]}>{CLAIM_STATUS[c.status]?.[1] || c.status}</Badge> },
                { label: "Details", render: (c) => (
                  <div className="text-xs text-slate-600 max-w-[240px]">
                    <div>{c.reason}</div>
                    {c.adminNote && <div className="mt-1 text-slate-800"><b>Raydo:</b> {c.adminNote}</div>}
                    <div className="text-slate-400 mt-0.5">{when(c.claimedAt)}</div>
                  </div>
                ) },
                { label: "", render: (c) => (c.status === "waiting" ? (
                  <button className={btn.ghost} disabled={busy === c.id} onClick={() => withdraw(c.id)}>
                    {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Withdraw
                  </button>
                ) : null) },
              ]}
            />
          )}
      </Card>
    </div>
  );
}

/** Opened from an order row: shows what can be claimed and files the claim. */
export function ClaimModal({ order, onClose, onFiled }) {
  const info = useLoad(() => franchiseApi.claimableForOrder(order.id), [order.id]);
  const [f, setF] = useState({ amount: "", paidVia: "upi", paymentReference: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = info.data;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const amountProblem = !f.amount ? "" : !isAmount(f.amount, { allowZero: false }) ? "Enter rupees, up to 2 decimals"
    : d && Number(f.amount) > d.claimable ? `You can claim up to ${inr2(d.claimable)}` : "";

  const file = async () => {
    setError("");
    if (!f.amount || amountProblem) { setError(amountProblem || "Enter the amount you refunded"); return; }
    if (f.paidVia !== "cash" && f.paymentReference.trim().length < 4) { setError("Enter the UPI / bank payment reference"); return; }
    if (f.reason.trim().length < 10) { setError("Say in a sentence why the customer was refunded"); return; }
    setBusy(true);
    try {
      await franchiseApi.fileRefundClaim({ orderId: order.id, ...f, amount: f.amount.trim() });
      toast.success("Claim sent to Raydo");
      onFiled();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = d && (d.notAllowed || d.openClaim || d.claimable <= 0);
  return (
    <Modal open title={`Claim a refund for #${order.orderId}`} onClose={() => !busy && onClose()} footer={(
      <>
        <button className={btn.ghost} onClick={onClose} disabled={busy}><X className="w-3.5 h-3.5" /> Close</button>
        {!blocked && <button className={btn.primary} onClick={file} disabled={busy || !d}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send claim</button>}
      </>
    )}>
      {info.error && !d ? <ErrorState message={info.error} onRetry={info.reload} />
        : !d ? <Loading />
        : blocked ? (
          <p className="text-sm text-slate-700">
            {d.notAllowed || (d.openClaim ? "This order already has a claim waiting. See Refund claims." : "Nothing is left to claim on this order.")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2"><div className="text-[10px] font-bold uppercase text-slate-400">Order total</div><div className="font-black">{inr2(d.total)}</div></div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2"><div className="text-[10px] font-bold uppercase text-slate-400">Raydo refunded</div><div className="font-black">{inr2(d.platformRefunded)}</div></div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2"><div className="text-[10px] font-bold uppercase text-emerald-700">You can claim</div><div className="font-black text-emerald-700">{inr2(d.claimable)}</div></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Amount you refunded (₹)" error={amountProblem}>
                <input aria-label="Amount you refunded" inputMode="decimal" value={f.amount} onChange={set("amount")} className={inputCls} placeholder={String(d.claimable)} />
              </Field>
              <Field label="How you paid the customer">
                <select aria-label="How you paid the customer" value={f.paidVia} onChange={set("paidVia")} className={inputCls}>
                  {Object.entries(PAID_VIA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field label={f.paidVia === "cash" ? "Receipt or note (optional)" : "Payment reference (UTR / UPI ref)"}>
              <input aria-label="Payment reference" value={f.paymentReference} onChange={set("paymentReference")} className={inputCls} maxLength={60} />
            </Field>
            <Field label="Why was the customer refunded?">
              <textarea aria-label="Reason for the refund" value={f.reason} onChange={set("reason")} rows={3} maxLength={500} className={inputCls} />
            </Field>
            {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
          </>
        )}
    </Modal>
  );
}
