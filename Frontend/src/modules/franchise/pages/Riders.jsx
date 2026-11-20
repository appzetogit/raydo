import React, { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Field, Loading, Modal, Pager, btn, errMsg, inputCls, when } from "@food/pages/admin/franchise/finance/ui";
import { DocumentGrid, Facts, PageTitle, Pills, SearchBox, Table, useDebounced, useLoad } from "./common";

const LIMIT = 20;

/** Food delivery riders in the franchise's zone: review documents, approve or reject. */
export default function Riders() {
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const list = useLoad(
    () => franchiseApi.riders({ status: status === "all" ? undefined : status, search: q || undefined, page, limit: LIMIT }),
    [status, q, page],
  );
  const counts = list.data?.counts || {};
  const setFilter = (v) => { setStatus(v); setPage(1); };

  return (
    <div>
      <PageTitle title="Delivery riders" sub="Riders who signed up in your zone. Check their documents before approving." onRefresh={list.reload} loading={list.loading} />
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <Pills value={status} onChange={setFilter} options={[
            ["pending", "Waiting", counts.pending], ["approved", "Approved", counts.approved], ["rejected", "Rejected", counts.rejected], ["all", "All"],
          ]} />
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Name, phone or vehicle" />
        </div>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
          : !list.data ? <Loading />
          : !list.data.items.length ? <Empty>No riders here.</Empty>
          : (
            <>
              <Table
                rows={list.data.items}
                onRow={(r) => setOpenId(r.id)}
                columns={[
                  { label: "Rider", render: (r) => <div><div className="font-bold">{r.name}</div><div className="text-xs text-slate-500">{r.phone}</div></div> },
                  { label: "Vehicle", render: (r) => <div className="text-xs"><div className="font-semibold">{r.vehicleType || "-"}</div><div className="text-slate-500">{r.vehicleNumber}</div></div> },
                  { label: "Status", render: (r) => <Badge status={r.status} /> },
                  { label: "Signed up", render: (r) => <span className="text-xs text-slate-500">{when(r.joinedAt)}</span> },
                ]}
              />
              <Pager page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
            </>
          )}
      </Card>
      {openId && <RiderModal id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

function RiderModal({ id, onClose, onChanged }) {
  const rider = useLoad(() => franchiseApi.rider(id), [id]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");

  const decide = async (action) => {
    if (action === "reject" && reason.trim().length < 3) {
      toast.error("Please give a reason");
      return;
    }
    setBusy(action);
    try {
      await franchiseApi.decideRider(id, { action, reason: action === "reject" ? reason.trim() : undefined });
      toast.success(action === "approve" ? "Rider approved" : "Rider rejected");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy("");
    }
  };

  const r = rider.data;
  const footer = r && r.status !== "approved" && (
    rejecting ? (
      <>
        <button className={btn.ghost} onClick={() => setRejecting(false)} disabled={Boolean(busy)}>Back</button>
        <button className={btn.danger} onClick={() => decide("reject")} disabled={Boolean(busy)}>
          {busy === "reject" && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reject rider
        </button>
      </>
    ) : (
      <>
        {r.status !== "rejected" && <button className={btn.ghost} onClick={() => setRejecting(true)} disabled={Boolean(busy)}><X className="w-3.5 h-3.5" /> Reject</button>}
        <button className={btn.success} onClick={() => decide("approve")} disabled={Boolean(busy)}>
          {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
        </button>
      </>
    )
  );

  return (
    <Modal open title={r ? r.name : "Rider"} onClose={onClose} wide footer={footer || null}>
      {rider.error && !r ? <ErrorState message={rider.error} onRetry={rider.reload} />
        : !r ? <Loading />
        : (
          <>
            <div className="flex items-center gap-2"><Badge status={r.status} />{r.rejectionReason && <span className="text-xs text-red-700">{r.rejectionReason}</span>}</div>
            <Facts items={[
              ["Phone", r.phone], ["Email", r.email], ["City", r.city], ["Zone", r.zoneName], ["Address", r.address],
              ["Vehicle", [r.vehicleType, r.vehicleName].filter(Boolean).join(" · ")], ["Vehicle number", r.vehicleNumber],
              ["Driving licence", r.drivingLicenseNumber], ["Aadhaar", r.aadharNumber], ["PAN", r.panNumber],
              ["Signed up", when(r.joinedAt)], ["Rating", r.totalRatings ? `${r.rating} (${r.totalRatings})` : ""],
            ]} />
            <div>
              <h4 className="text-xs font-extrabold uppercase text-slate-500 mb-2">Documents</h4>
              <DocumentGrid documents={r.documents} />
            </div>
            {rejecting && (
              <Field label="Reason for rejecting" hint="The rider sees this reason.">
                <textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} className={inputCls} autoFocus />
              </Field>
            )}
          </>
        )}
    </Modal>
  );
}
