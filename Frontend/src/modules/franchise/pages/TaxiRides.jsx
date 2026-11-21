import React, { useState } from "react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Loading, Pager, inr, when } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, Pills, Table, useLoad } from "./common";

const LIMIT = 25;
const RIDE_BADGE = (s) => (s === "completed" ? "approved" : s === "refunded" || /cancel/.test(s || "") ? "rejected" : "pending");
const BOOKING_KINDS = ["bus", "pooling", "rental"];
const KIND_NOTE = {
  bus: "Bus tickets earn once the travel day is over.",
  pooling: "Pooling trips earn once completed and paid.",
  rental: "Rentals earn once completed and paid.",
};

/** Taxi rides plus bus, pooling and rental bookings credited to the franchise. */
export default function TaxiRides() {
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const booking = BOOKING_KINDS.includes(view);

  const list = useLoad(
    () => (booking
      ? franchiseApi.taxiBookings({ service: view, page, limit: LIMIT })
      : franchiseApi.taxiRides({ service: view === "all" ? undefined : view, page, limit: LIMIT })),
    [view, page],
  );

  return (
    <div>
      <PageTitle title="Taxi" sub="Rides and bookings in your taxi zone, and what you earned on each." onRefresh={list.reload} loading={list.loading} />
      <Card>
        <div className="mb-4 space-y-2">
          <Pills value={view} onChange={(v) => { setView(v); setPage(1); }} options={[
            ["all", "All rides"], ["ride", "City taxi"], ["intercity", "Outstation"], ["parcel", "Parcel"],
            ["bus", "Bus"], ["pooling", "Pooling"], ["rental", "Rental"],
          ]} />
          {booking && <p className="text-xs text-slate-500">{KIND_NOTE[view]}</p>}
        </div>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>{booking ? "No bookings credited to you yet." : "No rides yet."}</Empty>
          : (
            <>
              {booking ? (
                <Table
                  rows={list.data.items}
                  columns={[
                    { label: "Booking", render: (r) => <div><div className="font-bold">{r.bookingCode}</div><div className="text-xs text-slate-500">{r.operator}</div></div> },
                    { label: "Route", render: (r) => <span className="text-xs">{r.route}</span> },
                    { label: "Date", render: (r) => <span className="text-xs">{r.travelDate}</span> },
                    { label: view === "rental" ? "Hours" : "Seats", render: (r) => <span className="text-xs">{r.seats || "-"}</span> },
                    { label: "Status", render: (r) => <Badge status={RIDE_BADGE(r.status === "confirmed" ? "completed" : r.status)}>{String(r.status || "-").replace(/_/g, " ")}</Badge> },
                    { label: "Paid", right: true, render: (r) => inr(r.amount) },
                    { label: "Raydo earned", right: true, render: (r) => inr(r.platformEarning) },
                    { label: "You earned", right: true, render: (r) => <span className="font-bold text-emerald-700">{inr(r.franchiseEarned)}</span> },
                  ]}
                />
              ) : (
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
              )}
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
    </div>
  );
}
