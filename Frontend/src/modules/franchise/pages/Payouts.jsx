import React, { useState } from "react";
import { toast } from "sonner";
import { Banknote, Info, Loader2, Pencil, Send, ShieldCheck, Wallet, X } from "lucide-react";
import { franchiseApi } from "../api";
import {
  Badge, Card, Empty, ErrorState, Field, Loading, Modal, Stat, btn, errMsg, inputCls, inr2, isAmount, when,
} from "@food/pages/admin/franchise/finance/ui";
import { Table, useLoad } from "./common";

const STATUS = {
  pending: ["pending", "Waiting"],
  approved: ["approved", "Paid"],
  rejected: ["rejected", "Rejected"],
  cancelled: ["not_required", "Cancelled"],
};

/** Ask for a payout to the saved bank account or UPI id, and manage those details. */
export default function Payouts() {
  const info = useLoad(() => franchiseApi.payouts(), []);
  const [editing, setEditing] = useState(false);
  const d = info.data;

  if (info.error && !d) return <ErrorState message={info.error} onRetry={info.reload} />;
  if (!d) return <Loading />;

  return (
    <div className="space-y-4">
      <Card title="Your wallet" icon={Wallet}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Can be paid out" value={inr2(d.available)} tone="text-emerald-700" />
          <Stat label="Wallet balance" value={inr2(d.wallet)} sub={d.pending ? `${inr2(d.pending.amount)} waiting to be paid` : undefined} />
          <Stat label="Minimum payout" value={inr2(d.minPayout)} />
          <Stat label="Payout cycle" value={String(d.payoutCycle).replace(/^./, (c) => c.toUpperCase())} />
        </div>
      </Card>

      {d.pending ? (
        <PendingCard pending={d.pending} onChanged={info.reload} />
      ) : (
        <RequestCard data={d} onDone={info.reload} onAddPayee={() => setEditing(true)} />
      )}

      <Card
        title="Where we pay you"
        icon={Banknote}
        right={(
          <button className={btn.ghost} onClick={() => setEditing(true)} disabled={Boolean(d.pending)}
            title={d.pending ? "You can change this after the waiting payout is paid or cancelled" : undefined}>
            <Pencil className="w-3.5 h-3.5" /> {d.payee.hasBank || d.payee.hasUpi ? "Change" : "Add"}
          </button>
        )}
      >
        {d.payee.hasBank || d.payee.hasUpi ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {d.payee.hasBank && (
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-[10px] font-bold uppercase text-slate-400">Bank account</div>
                <div className="font-bold mt-1">{d.payee.accountHolderName}</div>
                <div className="text-slate-600">{d.payee.bankName}</div>
                <div className="font-mono text-slate-700">{d.payee.accountNumber} · {d.payee.ifscCode}</div>
              </div>
            )}
            {d.payee.hasUpi && (
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-[10px] font-bold uppercase text-slate-400">UPI</div>
                <div className="font-mono text-slate-700 mt-1">{d.payee.upiId}</div>
              </div>
            )}
            {d.payee.updatedAt && <p className="text-xs text-slate-400 sm:col-span-2">Last changed {when(d.payee.updatedAt)}</p>}
          </div>
        ) : (
          <Empty icon={Banknote}>Add a bank account or UPI id to receive payouts.</Empty>
        )}
      </Card>

      <Card title="Payout history" icon={Send}>
        {d.requests.length ? (
          <Table
            rowKey={(r) => r.requestId}
            rows={d.requests}
            columns={[
              { label: "Requested", render: (r) => <span className="text-xs">{when(r.requestedAt)}</span> },
              { label: "Amount", right: true, render: (r) => <span className="font-bold">{inr2(r.amount)}</span> },
              { label: "To", render: (r) => <span className="text-xs font-mono">{r.payoutMethod === "upi" ? "UPI " : ""}{r.payTo}</span> },
              { label: "Status", render: (r) => <Badge status={STATUS[r.status]?.[0]}>{STATUS[r.status]?.[1] || r.status}</Badge> },
              { label: "Details", render: (r) => <span className="text-xs text-slate-600">{r.reference ? `Ref ${r.reference}` : r.adminNote || (r.processedAt ? when(r.processedAt) : "-")}</span> },
            ]}
          />
        ) : <Empty>No payouts yet.</Empty>}
      </Card>

      {editing && <PayeeModal onClose={() => setEditing(false)} onSaved={() => { setEditing(false); info.reload(); }} />}
    </div>
  );
}

function RequestCard({ data: d, onDone, onAddPayee }) {
  const methods = [d.payee.hasBank && ["bank", "Bank account"], d.payee.hasUpi && ["upi", "UPI"]].filter(Boolean);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(methods[0]?.[0] || "bank");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  let blocked = "";
  if (!d.feeSettled) blocked = "Your franchise fee is still due. Payouts open once it is paid.";
  else if (!methods.length) blocked = "Add a bank account or UPI id below first.";
  else if (d.available < Math.max(d.minPayout, 0.01)) blocked = `You need at least ${inr2(Math.max(d.minPayout, 1))} available to ask for a payout.`;

  const value = Number(amount);
  const problem = !amount ? "" : !isAmount(amount, { allowZero: false }) ? "Enter an amount in rupees, up to 2 decimals"
    : value < d.minPayout ? `The minimum is ${inr2(d.minPayout)}`
    : value > d.available ? `You can ask for up to ${inr2(d.available)}` : "";

  const send = async () => {
    setBusy(true);
    try {
      await franchiseApi.requestPayout({ amount: amount.trim(), method });
      toast.success("Payout requested. Raydo will pay it on your cycle.");
      setConfirming(false);
      setAmount("");
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Ask for a payout" icon={Send}>
      {blocked ? (
        <div className="flex items-start gap-2 text-sm text-slate-600">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
          <div>{blocked}{!methods.length && d.feeSettled && <button onClick={onAddPayee} className="ml-1 font-bold text-blue-600 underline">Add now</button>}</div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (amount && !problem) setConfirming(true); }} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <Field label="Amount (₹)" error={problem}>
            <div className="flex gap-2">
              <input aria-label="Amount in rupees" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder={String(d.available)} />
              <button type="button" className={btn.ghost} onClick={() => setAmount(String(d.available))}>All</button>
            </div>
          </Field>
          <Field label="Pay to">
            <select aria-label="Pay to" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
              {methods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <div className="sm:pt-5">
            <button type="submit" className={`${btn.primary} w-full py-3`} disabled={!amount || Boolean(problem)}>Request payout</button>
          </div>
        </form>
      )}
      <Modal open={confirming} title="Request this payout?" onClose={() => !busy && setConfirming(false)} footer={(
        <>
          <button className={btn.ghost} onClick={() => setConfirming(false)} disabled={busy}>Back</button>
          <button className={btn.primary} onClick={send} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Request {inr2(value)}</button>
        </>
      )}>
        <p className="text-sm text-slate-700">
          {inr2(value)} to your {method === "upi" ? `UPI id ${d.payee.upiId}` : `${d.payee.bankName} account ${d.payee.accountNumber}`}.
        </p>
        <p className="text-xs text-slate-500">Raydo transfers it and sends you the payment reference. You can cancel it until then.</p>
      </Modal>
    </Card>
  );
}

function PendingCard({ pending, onChanged }) {
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      await franchiseApi.cancelPayout(pending.requestId);
      toast.success("Payout request cancelled");
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Payout waiting" icon={Send} right={<Badge status="pending">Waiting</Badge>}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-2xl font-black text-slate-900">{inr2(pending.amount)}</div>
          <div className="text-xs text-slate-500">To {pending.payoutMethod === "upi" ? "UPI " : ""}{pending.payTo} · requested {when(pending.requestedAt)}</div>
        </div>
        <button className={btn.ghost} onClick={cancel} disabled={busy}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Cancel request</button>
      </div>
    </Card>
  );
}

function PayeeModal({ onClose, onSaved }) {
  const [f, setF] = useState({ accountHolderName: "", bankName: "", accountNumber: "", ifscCode: "", upiId: "", currentPassword: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (!f.currentPassword) { setError("Enter your password to save"); return; }
    setBusy(true);
    try {
      await franchiseApi.savePayee(f);
      toast.success("Payment details saved");
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Where we pay you" onClose={() => !busy && onClose()} footer={(
      <>
        <button className={btn.ghost} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={btn.primary} onClick={save} disabled={busy}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</button>
      </>
    )}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-slate-500">Fill in a bank account, a UPI id, or both. This replaces what is saved now.</p>
        <Field label="Account holder name"><input aria-label="Account holder name" value={f.accountHolderName} onChange={set("accountHolderName")} className={inputCls} autoComplete="name" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Bank name"><input aria-label="Bank name" value={f.bankName} onChange={set("bankName")} className={inputCls} /></Field>
          <Field label="IFSC code"><input aria-label="IFSC code" value={f.ifscCode} onChange={(e) => setF({ ...f, ifscCode: e.target.value.toUpperCase() })} className={inputCls} maxLength={11} placeholder="SBIN0001234" /></Field>
        </div>
        <Field label="Account number"><input aria-label="Account number" value={f.accountNumber} onChange={set("accountNumber")} className={inputCls} inputMode="numeric" maxLength={18} /></Field>
        <Field label="UPI id (optional)"><input aria-label="UPI id" value={f.upiId} onChange={set("upiId")} className={inputCls} placeholder="name@bank" /></Field>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <Field label="Your password" hint="Needed to change where your money goes.">
            <input aria-label="Your password" type="password" value={f.currentPassword} onChange={set("currentPassword")} className={inputCls} autoComplete="current-password" />
          </Field>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2"><ShieldCheck className="w-3.5 h-3.5" /> Raydo checks payouts requested soon after a change.</p>
        </div>
        {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
