import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, IndianRupee, Info, Landmark, Truck, Wallet } from "lucide-react";
import { franchiseApi, session } from "../api";
import {
  Badge, Card, DateRange, Empty, ErrorState, Loading, Pager, Stat, dayLabel, inr, inr2, istDaysAgo, istToday, pct, when,
} from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Pills, Table, useLoad } from "./common";

const holdsFood = () => (session.user?.franchise?.modules || []).includes("food");

export default function Money() {
  const [params, setParams] = useSearchParams();
  const food = holdsFood();
  const tabs = [["earnings", "Earnings"], ...(food ? [["payments", "Order payments"], ["delivery", "Delivery fees"]] : []), ["fees", "Fees & deposit"]];
  const tab = tabs.some(([k]) => k === params.get("tab")) ? params.get("tab") : "earnings";

  return (
    <div>
      <PageTitle title="Earnings & wallet" sub="Every figure here comes from Raydo's ledger." />
      <div className="mb-4"><Pills value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} options={tabs} /></div>
      {tab === "earnings" && <Earnings />}
      {tab === "payments" && <Payments />}
      {tab === "delivery" && <DeliveryFees />}
      {tab === "fees" && <FeesAndDeposit />}
    </div>
  );
}

function Earnings() {
  const [range, setRange] = useState({ from: istDaysAgo(29), to: istToday() });
  const fin = useLoad(() => franchiseApi.finance(range), [range.from, range.to]);
  const d = fin.data;
  const services = d?.franchise?.services || [];

  return (
    <div className="space-y-4">
      {d && (
        <Card title="Wallet" icon={Wallet}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Balance" value={inr2(d.wallet.balance)} tone="text-blue-700" />
            <Stat label="Available" value={inr2(d.wallet.available)} sub={d.wallet.pendingPayoutCount ? `${inr(d.wallet.pendingPayoutAmount)} in ${d.wallet.pendingPayoutCount} pending payout(s)` : undefined} />
            <Stat label="Paid out so far" value={inr2(d.wallet.paidOut)} />
            <Stat label="Earned so far" value={inr2(d.wallet.lifetimeEarnings)} sub={`Platform share ${inr(d.wallet.lifetimeCommission)}`} />
          </div>
          <p className="flex items-start gap-2 text-xs text-slate-500 mt-4">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Payouts are paid on your {d.franchise.payoutCycle || "weekly"} cycle. Requesting a payout from here is not switched on yet; contact support if you need one now.
          </p>
        </Card>
      )}

      <Card title="Earnings by day" icon={IndianRupee}>
        <div className="mb-4"><DateRange from={range.from} to={range.to} onChange={setRange} /></div>
        {fin.error && !d ? <ErrorState message={fin.error} onRetry={fin.reload} />
          : !d ? <Loading />
          : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <Stat label="Earned" value={inr2(d.totals.totalEarning)} />
                <Stat label="Platform share" value={inr2(d.totals.totalCommission)} sub={services.map((s) => `${s} ${pct(d.rates?.[s]?.rate)}`).join(" · ")} />
                <Stat label="Your net" value={inr2(d.totals.franchiseNet)} tone="text-emerald-700" />
                <Stat label="Refunds" value={inr2(d.totals.refunds)} />
              </div>
              {d.daily.length ? (
                <Table
                  rowKey={(r) => r.date}
                  rows={d.daily}
                  columns={[
                    { label: "Day", render: (r) => <span className="font-semibold">{dayLabel(r.date)}</span> },
                    ...(services.includes("food") ? [{ label: "Food", right: true, render: (r) => <span>{inr2(r.foodEarning)}<span className="block text-[10px] text-slate-400">{r.foodCount} orders</span></span> }] : []),
                    ...(services.includes("taxi") ? [{ label: "Taxi", right: true, render: (r) => <span>{inr2(r.taxiEarning)}<span className="block text-[10px] text-slate-400">{r.taxiCount} rides</span></span> }] : []),
                    { label: "Platform share", right: true, render: (r) => inr2(r.totalCommission) },
                    { label: "Refunds", right: true, render: (r) => inr2(r.refunds) },
                    { label: "Your net", right: true, render: (r) => <span className="font-bold text-emerald-700">{inr2(r.franchiseNet)}</span> },
                  ]}
                />
              ) : <Empty>No earnings in these dates.</Empty>}
            </>
          )}
      </Card>

      {d?.payouts?.length > 0 && (
        <Card title="Payouts" icon={Landmark}>
          <Table
            rowKey={(p) => p.requestId}
            rows={d.payouts}
            columns={[
              { label: "Requested", render: (p) => <span className="text-xs">{when(p.requestedAt)}</span> },
              { label: "Status", render: (p) => <Badge status={p.status} /> },
              { label: "Method", render: (p) => p.payoutMethod || "-" },
              { label: "Reference", render: (p) => <span className="text-xs">{p.transactionId || "-"}</span> },
              { label: "Amount", right: true, render: (p) => inr2(p.amount) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

const METHOD = { cash: "Cash", razorpay: "Online", razorpay_qr: "UPI QR", wallet: "Wallet" };

function Payments() {
  const [range, setRange] = useState({ from: istDaysAgo(6), to: istToday() });
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);
  const list = useLoad(() => franchiseApi.payments({ ...range, method: method || undefined, page, limit: 25 }), [range.from, range.to, method, page]);
  const s = list.data?.summary;

  return (
    <Card title="How your territory's orders were paid" icon={CreditCard}>
      <div className="flex flex-col gap-3 mb-4">
        <DateRange from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1); }} />
        <Pills value={method} onChange={(v) => { setMethod(v); setPage(1); }} options={[["", "All"], ...Object.entries(METHOD)]} />
      </div>
      {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
        : !list.data ? <Loading />
        : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              <Stat label="Orders" value={s.totalOrders} />
              <Stat label="Collected" value={inr2(s.totalAmount)} />
              <Stat label="Refunded" value={inr2(s.totalRefunded)} />
              <Stat label="Cash orders" value={s.byMethod?.cash?.orders || 0} sub={inr(s.byMethod?.cash?.amount)} />
            </div>
            {list.data.items.length ? (
              <>
                <Table
                  rows={list.data.items}
                  columns={[
                    { label: "Order", render: (o) => <div><div className="font-bold">#{o.orderId}</div><div className="text-xs text-slate-500">{when(o.createdAt)}</div></div> },
                    { label: "Restaurant", render: (o) => o.restaurantName },
                    { label: "Paid by", render: (o) => <span className="text-xs">{METHOD[o.method] || o.method || "-"}<span className="block text-slate-400">{o.paymentStatus}</span></span> },
                    { label: "Total", right: true, render: (o) => inr2(o.total) },
                    { label: "Restaurant share", right: true, render: (o) => inr2(o.restaurantShare) },
                    { label: "Rider share", right: true, render: (o) => inr2(o.riderShare) },
                    { label: "Tax", right: true, render: (o) => inr2(o.tax) },
                    { label: "Refund", right: true, render: (o) => (o.refundStatus === "none" ? "-" : <span className="text-xs">{inr2(o.refundAmount)}<span className="block text-slate-400">{o.refundStatus}</span></span>) },
                  ]}
                />
                <Pager page={page} limit={25} total={list.data.total} onPage={setPage} />
              </>
            ) : <Empty>No payments in these dates.</Empty>}
          </>
        )}
    </Card>
  );
}

function DeliveryFees() {
  const fees = useLoad(() => franchiseApi.deliveryFees(), []);
  const d = fees.data;
  const slabs = d ? (d.usingZoneFees ? d.zoneSlabs : d.platformSlabs) : [];

  return (
    <Card title={d?.zone?.name ? `Delivery fee in ${d.zone.name}` : "Delivery fee"} icon={Truck}>
      {fees.error && !d ? <ErrorState message={fees.error} onRetry={fees.reload} />
        : !d ? <Loading />
        : (
          <>
            <p className="text-sm text-slate-600 mb-4">
              {d.usingZoneFees ? "Your zone has its own delivery fee." : "Your zone uses Raydo's standard delivery fee."}
              {" "}The fee is set by distance and goes to the rider in full. To change it, contact support.
            </p>
            {slabs.length ? (
              <Table
                rows={slabs}
                columns={[
                  { label: "Slab", render: (s) => <span className="font-semibold">{s.name}</span> },
                  { label: "Distance", render: (s) => `${s.minDistance} km - ${s.maxDistance === null ? "and above" : `${s.maxDistance} km`}` },
                  { label: "Base fee", right: true, render: (s) => inr2(s.basePayout) },
                  { label: "Per km", right: true, render: (s) => inr2(s.commissionPerKm) },
                  { label: "Status", render: (s) => <Badge status={s.status ? "active" : "suspended"}>{s.status ? "On" : "Off"}</Badge> },
                ]}
              />
            ) : <Empty>No delivery fee slabs are set.</Empty>}
          </>
        )}
    </Card>
  );
}

function FeesAndDeposit() {
  const fin = useLoad(() => franchiseApi.finance({}), []);
  const d = fin.data;

  return (
    <Card title="Joining fee and security deposit" icon={Landmark}>
      {fin.error && !d ? <ErrorState message={fin.error} onRetry={fin.reload} />
        : !d ? <Loading />
        : !d.charges.length ? <Empty>No fees are set for your franchise.</Empty>
        : (
          <div className="space-y-4">
            {d.dues?.hasDues && (
              <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                {inr2(d.dues.outstanding)} is still due. Contact support for payment details.
              </p>
            )}
            {d.charges.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div className="font-extrabold">{c.label}</div>
                  <Badge status={c.status} />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Stat label="Amount" value={inr2(c.expected)} />
                  <Stat label="Paid" value={inr2(c.paid)} />
                  {c.waived > 0 && <Stat label="Waived" value={inr2(c.waived)} />}
                  <Stat label="Still due" value={inr2(c.outstanding)} tone={c.outstanding > 0 ? "text-amber-700" : "text-slate-900"} />
                  {c.kind === "security_deposit" && <Stat label="Held by Raydo" value={inr2(c.held)} />}
                  {c.refunded > 0 && <Stat label="Refunded" value={inr2(c.refunded)} />}
                  {c.deducted > 0 && <Stat label="Deducted" value={inr2(c.deducted)} />}
                </div>
                {c.payments?.length > 0 && (
                  <div className="mt-3 text-xs text-slate-500 space-y-1">
                    {c.payments.map((p) => (
                      <div key={p.id}>{inr2(p.amount)} on {when(p.paidAt)}{p.reference ? ` · ref ${p.reference}` : ""}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}
