import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bike, Car, ClipboardList, IndianRupee, Store, Wallet } from "lucide-react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Loading, Stat, inr, pct, when } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Table, orderBadge, useLoad } from "./common";

export default function Dashboard() {
  const { loading, error, data, reload } = useLoad(() => franchiseApi.me(), []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const modules = data.partnerInfo?.selectedModules || [];
  const hasFood = modules.includes("food");
  const hasTaxi = modules.includes("taxi");
  const m = data.territoryMetrics || {};
  const fin = data.financialSettings || {};
  const taxi = data.taxi;
  const area = [data.territoryInfo?.area, data.territoryInfo?.city, data.territoryInfo?.state].filter(Boolean).join(", ");

  return (
    <div className="space-y-5">
      <PageTitle title={`Hello, ${data.partnerInfo?.applicantName || "partner"}`} sub={area || undefined} onRefresh={reload} loading={loading} />

      {fin.amountDue > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-200 bg-amber-50">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-extrabold text-amber-900">{inr(fin.amountDue)} of fees is still due</div>
            <div className="text-amber-800">See the joining fee and deposit under <Link to="/franchise/money?tab=fees" className="font-bold underline">Earnings &amp; wallet</Link>.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Wallet balance" value={inr(fin.walletBalance)} sub={`Available ${inr(fin.availableBalance)}`} icon={Wallet} tone="text-blue-700" />
        <Stat label="Total earned" value={inr(m.franchiseEarnings)} icon={IndianRupee} tone="text-emerald-700" />
        {hasFood && <Stat label="Food: earned" value={inr(data.earningsByModule?.food)} icon={ClipboardList} />}
        {hasTaxi && <Stat label="Taxi: earned" value={inr(data.earningsByModule?.taxi)} icon={Car} />}
      </div>

      {hasFood && (
        <Card title="Food" icon={ClipboardList} right={<Link to="/franchise/orders" className="text-xs font-bold text-blue-600">All orders</Link>}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Orders" value={m.totalOrders || 0} />
            <Stat label="Delivered" value={m.deliveredOrders || 0} />
            <Stat label="Delivered value" value={inr(m.totalGMV)} />
            <Stat label="Restaurants" value={m.activeOutletsCount || 0} icon={Store} />
          </div>
          <h4 className="text-xs font-extrabold uppercase text-slate-500 mb-2">Recent orders</h4>
          {(data.territoryOrders || []).length ? (
            <Table
              rows={data.territoryOrders.slice(0, 8)}
              columns={[
                { label: "Order", render: (o) => <span className="font-bold">#{o.orderId}</span> },
                { label: "Customer", render: (o) => o.customerName },
                { label: "Status", render: (o) => <Badge status={orderBadge(o.orderStatus)}>{String(o.orderStatus || "-").replace(/_/g, " ")}</Badge> },
                { label: "Total", right: true, render: (o) => inr(o.total) },
                { label: "Placed", render: (o) => <span className="text-xs text-slate-500">{when(o.createdAt)}</span> },
              ]}
            />
          ) : <Empty>No orders in your territory yet.</Empty>}
        </Card>
      )}

      {hasTaxi && (
        <Card title="Taxi" icon={Car} right={<Link to="/franchise/rides" className="text-xs font-bold text-blue-600">All rides</Link>}>
          {taxi ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Zone" value={taxi.zone?.name || "Not assigned"} />
              <Stat label="Rides completed" value={taxi.rides?.completed || 0} sub={`${taxi.rides?.today || 0} today`} />
              <Stat label="Ride value" value={inr(taxi.rides?.gmv)} sub={`${inr(taxi.rides?.todayGMV)} today`} />
              <Stat label="Drivers" value={`${taxi.drivers?.approved || 0} / ${taxi.drivers?.total || 0}`} sub={`${taxi.drivers?.online || 0} online now`} icon={Bike} />
            </div>
          ) : <Empty>Taxi figures are not available right now.</Empty>}
        </Card>
      )}

      <Card title="Your terms" icon={IndianRupee}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {hasFood && <Stat label="Platform share, food" value={pct(fin.platformRates?.food?.rate)} sub="of your food earnings" />}
          {hasTaxi && <Stat label="Platform share, taxi" value={pct(fin.platformRates?.taxi?.rate)} sub="of your taxi earnings" />}
          <Stat label="Payout cycle" value={String(fin.payoutCycle || "weekly").replace(/^./, (c) => c.toUpperCase())} />
          <Stat label="Minimum payout" value={inr(fin.minPayoutThreshold)} />
        </div>
      </Card>
    </div>
  );
}
