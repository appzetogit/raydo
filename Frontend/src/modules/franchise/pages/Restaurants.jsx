import React, { useState } from "react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Loading, Pager, inr } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, SearchBox, Table, date, useDebounced, useLoad } from "./common";

const LIMIT = 25;

export default function Restaurants() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const list = useLoad(() => franchiseApi.restaurants({ search: q || undefined, page, limit: LIMIT }), [q, page]);

  return (
    <div>
      <PageTitle title="Restaurants" sub="Restaurants in your territory and how they are doing." onRefresh={list.reload} loading={list.loading}>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Restaurant name" />
      </PageTitle>
      <Card>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>No restaurants found.</Empty>
          : (
            <>
              <Table
                rows={list.data.items}
                columns={[
                  { label: "Restaurant", render: (r) => <div><div className="font-bold">{r.name}</div><div className="text-xs text-slate-500">{[r.ownerName, r.city].filter(Boolean).join(" · ")}</div></div> },
                  { label: "Contact", render: (r) => <div className="text-xs"><div>{r.phone || "-"}</div><div className="text-slate-500 truncate max-w-[180px]">{r.email}</div></div> },
                  { label: "Status", render: (r) => (
                    <div className="flex flex-col gap-1 items-start">
                      <Badge status={r.status || (r.isActive ? "active" : "suspended")} />
                      {!r.acceptingOrders && <span className="text-[10px] font-bold text-slate-400">Not taking orders</span>}
                    </div>
                  ) },
                  { label: "Orders", right: true, render: (r) => `${r.delivered} / ${r.orders}` },
                  { label: "Delivered value", right: true, render: (r) => inr(r.gmv) },
                  { label: "Joined", render: (r) => <span className="text-xs text-slate-500">{date(r.createdAt)}</span> },
                ]}
              />
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
    </div>
  );
}
