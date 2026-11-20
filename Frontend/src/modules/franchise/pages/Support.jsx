import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { franchiseApi } from "../api";
import { Badge, Card, Empty, ErrorState, Field, Loading, btn, errMsg, inputCls, when } from "@food/pages/admin/franchise/finance/ui";
import { PageTitle, useLoad } from "./common";

const PRIORITIES = [["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
const STATUS_BADGE = { replied: "approved", resolved: "active", pending: "pending", open: "pending", in_progress: "pending" };

export default function Support() {
  const me = useLoad(() => franchiseApi.me(), []);
  const [form, setForm] = useState({ subject: "", message: "", priority: "normal" });
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) {
      toast.error("Write your message first");
      return;
    }
    setBusy(true);
    try {
      await franchiseApi.sendSupportMessage({ subject: form.subject.trim() || undefined, message: form.message.trim(), priority: form.priority });
      toast.success("Message sent to Raydo support");
      setForm({ subject: "", message: "", priority: "normal" });
      me.reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const messages = me.data?.supportMessages || [];

  return (
    <div className="space-y-4">
      <PageTitle title="Support" sub="Questions about payouts, fees, your zone or anything else." />
      <Card title="New message" icon={Send}>
        <form onSubmit={send} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Field label="Subject"><input aria-label="Subject" value={form.subject} maxLength={120} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputCls} placeholder="What is it about?" /></Field>
            </div>
            <Field label="Priority">
              <select aria-label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputCls}>
                {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Message">
            <textarea aria-label="Message" value={form.message} rows={4} maxLength={2000} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputCls} />
          </Field>
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={btn.primary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send</button>
          </div>
        </form>
      </Card>

      <Card title="Your messages" icon={MessageSquare}>
        {me.error && !me.data ? <ErrorState message={me.error} onRetry={me.reload} />
          : !me.data ? <Loading />
          : !messages.length ? <Empty>No messages yet.</Empty>
          : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.messageId || m._id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-extrabold text-sm">{m.subject}</div>
                    <div className="flex items-center gap-2">
                      {m.priority !== "normal" && <Badge status="suspended">{m.priority}</Badge>}
                      <Badge status={STATUS_BADGE[m.status] || "pending"}>{String(m.status || "pending").replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{when(m.createdAt)}</div>
                  <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap break-words">{m.message}</p>
                  {m.reply && (
                    <div className="mt-3 rounded-lg bg-blue-50 border border-blue-100 p-3">
                      <div className="text-[10px] font-extrabold uppercase text-blue-700">Raydo replied</div>
                      <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words">{m.reply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  );
}
