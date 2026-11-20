import React, { useState } from "react";
import { toast } from "sonner";
import { Ban, Check, Loader2, RotateCcw, X } from "lucide-react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Field, Loading, Modal, Pager, btn, errMsg, inputCls, when } from "@food/pages/admin/franchise/finance/ui";
import { DocumentGrid, Facts, PageTitle, Pills, SearchBox, Table, useDebounced, useLoad } from "./common";

const LIMIT = 20;
const BADGE = { approved: "approved", pending: "pending", rejected: "rejected", blocked: "terminated" };

/** Taxi drivers in the franchise's taxi zone: approve, reject, block, unblock. */
export default function Drivers() {
  const [state, setState] = useState("pending");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const list = useLoad(
    () => franchiseApi.taxiDrivers({ state: state === "all" ? undefined : state, search: q || undefined, page, limit: LIMIT }),
    [state, q, page],
  );
  const setFilter = (v) => { setState(v); setPage(1); };

  return (
    <div>
      <PageTitle title="Taxi drivers" sub="Drivers registered in your taxi zone." onRefresh={list.reload} loading={list.loading} />
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <Pills value={state} onChange={setFilter} options={[
            ["pending", "Waiting"], ["approved", "Approved"], ["blocked", "Blocked"], ["rejected", "Rejected"], ["all", "All"],
          ]} />
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, phone or vehicle" />
        </div>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>No drivers here.</Empty>
          : (
            <>
              <Table
                rows={list.data.items}
                onRow={(d) => setOpenId(d.id)}
                columns={[
                  { label: "Driver", render: (d) => <div><div className="font-bold">{d.name}</div><div className="text-xs text-slate-500">{d.phone}</div></div> },
                  { label: "Vehicle", render: (d) => <div className="text-xs"><div className="font-semibold">{d.vehicleType || "-"}</div><div className="text-slate-500">{d.vehicleNumber}</div></div> },
                  { label: "Status", render: (d) => <Badge status={BADGE[d.state]}>{d.state}</Badge> },
                  { label: "Online", render: (d) => (d.online ? <span className="text-xs font-bold text-emerald-700">Online</span> : <span className="text-xs text-slate-400">Offline</span>) },
                  { label: "Joined", render: (d) => <span className="text-xs text-slate-500">{when(d.joinedAt)}</span> },
                ]}
              />
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
      {openId && <DriverModal id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

const NEEDS_REASON = { reject: "Reason for rejecting", block: "Reason for blocking" };
const DONE = { approve: "Driver approved", reject: "Driver rejected", block: "Driver blocked", unblock: "Driver unblocked" };

function DriverModal({ id, onClose, onChanged }) {
  const driver = useLoad(() => franchiseApi.taxiDriver(id), [id]);
  const [asking, setAsking] = useState(""); // 'reject' | 'block' while the reason box is open
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");

  const decide = async (action) => {
    if (NEEDS_REASON[action] && reason.trim().length < 3) {
      toast.error("Please give a reason");
      return;
    }
    setBusy(action);
    try {
      await franchiseApi.decideTaxiDriver(id, { action, reason: NEEDS_REASON[action] ? reason.trim() : undefined });
      toast.success(DONE[action]);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy("");
    }
  };

  const d = driver.data;
  const spin = (a) => busy === a && <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  let footer = null;
  if (d && asking) {
    footer = (
      <>
        <button className={btn.ghost} onClick={() => setAsking("")} disabled={Boolean(busy)}>Back</button>
        <button className={btn.danger} onClick={() => decide(asking)} disabled={Boolean(busy)}>{spin(asking)} {asking === "block" ? "Block driver" : "Reject driver"}</button>
      </>
    );
  } else if (d) {
    footer = (
      <>
        {d.state === "pending" && <button className={btn.ghost} onClick={() => setAsking("reject")} disabled={Boolean(busy)}><X className="w-3.5 h-3.5" /> Reject</button>}
        {d.state === "approved" && <button className={btn.danger} onClick={() => setAsking("block")} disabled={Boolean(busy) || d.onRide} title={d.onRide ? "The driver is on a ride now" : undefined}><Ban className="w-3.5 h-3.5" /> Block</button>}
        {d.state === "blocked" && <button className={btn.success} onClick={() => decide("unblock")} disabled={Boolean(busy)}>{spin("unblock") || <RotateCcw className="w-3.5 h-3.5" />} Unblock</button>}
        {(d.state === "pending" || d.state === "rejected") && <button className={btn.success} onClick={() => decide("approve")} disabled={Boolean(busy)}>{spin("approve") || <Check className="w-3.5 h-3.5" />} Approve</button>}
      </>
    );
  }

  return (
    <Modal open title={d ? d.name : "Driver"} onClose={onClose} wide footer={footer}>
      {driver.error && !d ? <ErrorState message={driver.error} onRetry={driver.reload} />
        : !d ? <Loading />
        : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge status={BADGE[d.state]}>{d.state}</Badge>
              {d.onRide && <Badge status="pending">On a ride</Badge>}
              {d.blockReason && <span className="text-xs text-red-700">{d.blockReason}</span>}
            </div>
            <Facts items={[
              ["Phone", d.phone], ["Email", d.email], ["City", d.city],
              ["Vehicle", [d.vehicleType, d.vehicleMake, d.vehicleModel, d.vehicleColor].filter(Boolean).join(" · ")],
              ["Vehicle number", d.vehicleNumber], ["Joined", when(d.joinedAt)],
              ["Rating", d.ratingCount ? `${d.rating} (${d.ratingCount})` : ""],
            ]} />
            <div>
              <h4 className="text-xs font-extrabold uppercase text-slate-500 mb-2">Documents</h4>
              <DocumentGrid documents={d.documents} />
            </div>
            {asking && (
              <Field label={NEEDS_REASON[asking]} hint="The driver sees this reason.">
                <textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className={inputCls} autoFocus />
              </Field>
            )}
          </>
        )}
    </Modal>
  );
}
