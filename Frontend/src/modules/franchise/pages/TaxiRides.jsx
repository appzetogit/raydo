import React, { useState } from "react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Loading, Pager, inr, when } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Pills, Table, useLoad } from "./common";

const LIMIT = 25;
const RIDE_BADGE = (s) => (s === "completed" ? "approved" : s === "refunded" || /cancel/.test(s || "") ? "rejected" : "pending");

export default function TaxiRides() {
  const [service, setService] = useState("");
  const [page, setPage] = useState(1);
  const list = useLoad(() => franchiseApi.taxiRides({ service: service || undefined, page, limit: LIMIT }), [service, page]);

  return (
    <div>
      <PageTitle title="Taxi rides" sub="Rides in your taxi zone and what you earned on each." onRefresh={list.reload} loading={list.loading} />
      <Card>
        <div className="mb-4">
          <Pills value={service} onChange={(v) => { setService(v); setPage(1); }} options={[
            ["", "All"], ["ride", "City taxi"], ["intercity", "Outstation"], ["parcel", "Parcel"],
          ]} />
        </div>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>No rides yet.</Empty>
          : (
            <>
              <Table
                rows={list.data.items}
                columns={[
                  { label: "Ride", render: (r) => <div><div className="font-bold">{r.rideCode}</div><div className="text-xs text-slate-500">{r.serviceLabel}</div></div> },
                  { label: "Rider", render: (r) => r.riderName },
                  { label: "Driver", render: (r) => r.driverName },
                  { label: "Status", render: (r) => <Badge status={RIDE_BADGE(r.status)}>{String(r.status || "-").replace(/_/g, " ")}</Badge> },
                  { label: "Fare", right: true, render: (r) => <span>{inr(r.fare)}<span className="block text-[10px] text-slate-400">{r.paymentMethod}</span></span> },
                  { label: "You earned", right: true, render: (r) => <span className="font-bold text-emerald-700">{inr(r.franchiseEarned)}</span> },
                  { label: "When", render: (r) => <span className="text-xs text-slate-500">{when(r.completedAt)}</span> },
                ]}
              />
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
    </div>
  );
}
