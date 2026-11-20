import React, { useState } from "react";
import { franchiseApi } from "../api";
import { Badge, Card, DateRange, Empty, ErrorState, Loading, Pager, inr, istDaysAgo, istToday, when } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Pills, Table, orderBadge as STATUS_BADGE, useLoad } from "./common";

const LIMIT = 25;

/** Food orders of the franchise's territory, with what the franchise earned on each. */
export default function Orders() {
  const [status, setStatus] = useState("");
  const [range, setRange] = useState({ from: istDaysAgo(29), to: istToday() });
  const [page, setPage] = useState(1);

  const list = useLoad(() => franchiseApi.orders({
    status: status || undefined,
    // Whole IST days, as the money pages count them.
    from: `${range.from}T00:00:00+05:30`, to: `${range.to}T23:59:59.999+05:30`,
    page, limit: LIMIT,
  }), [status, range.from, range.to, page]);

  return (
    <div>
      <PageTitle title="Food orders" sub="Orders placed with restaurants in your territory." onRefresh={list.reload} loading={list.loading} />
      <Card>
        <div className="flex flex-col gap-3 mb-4">
          <DateRange from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1); }} />
          <Pills value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
            ["", "All"], ["delivered", "Delivered"], ["cancelled", "Cancelled"],
          ]} />
        </div>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>No orders in these dates.</Empty>
          : (
            <>
              <Table
                rows={list.data.items}
                columns={[
                  { label: "Order", render: (o) => <div><div className="font-bold">#{o.orderId}</div><div className="text-xs text-slate-500">{when(o.createdAt)}</div></div> },
                  { label: "Restaurant", render: (o) => o.restaurantName || "-" },
                  { label: "Customer", render: (o) => o.customerName },
                  { label: "Status", render: (o) => <Badge status={STATUS_BADGE(o.status)}>{String(o.status || "-").replace(/_/g, " ")}</Badge> },
                  { label: "Payment", render: (o) => <span className="text-xs">{o.paymentMethod || "-"}<span className="text-slate-400"> · {o.paymentStatus || "-"}</span></span> },
                  { label: "Total", right: true, render: (o) => inr(o.total) },
                  { label: "You earned", right: true, render: (o) => <span className="font-bold text-emerald-700">{inr(o.franchiseEarned)}</span> },
                ]}
              />
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
    </div>
  );
}
