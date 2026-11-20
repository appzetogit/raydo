import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { errMsg, inputCls, btn } from "@food/pages/admin/franchise/finance/ui";

/** Load `fn(...deps)`; re-runs when deps change. Old answers that arrive late are dropped. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    return fn()
      .then((data) => { if (id === seq.current) setState({ loading: false, error: "", data }); })
      .catch((err) => { if (id === seq.current) setState((s) => ({ loading: false, error: errMsg(err, "Could not load"), data: s.data })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

/** Text that settles 400 ms after the last keystroke. */
export function useDebounced(value, ms = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function PageTitle({ title, sub, onRefresh, loading, children }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">{title}</h1>
        {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {children}
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading} className={btn.ghost} aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className={`${inputCls} pl-9 py-2`} />
    </div>
  );
}

/** Filter pills: [[value, label, count?], ...] */
export function Pills({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap" role="tablist">
      {options.map(([v, label, count]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${value === v ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}>
          {label}{count !== undefined && <span className={`ml-1.5 ${value === v ? "text-blue-100" : "text-slate-400"}`}>{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A plain responsive table: scrolls sideways inside its card on a phone. */
export function Table({ columns, rows, onRow, rowKey = (r) => r.id }) {
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left text-[10px] font-extrabold uppercase text-slate-500 border-b border-slate-200">
            {columns.map((c, i) => <th key={i} className={`py-2 pr-3 ${c.right ? "text-right" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined}
              className={`border-b border-slate-100 last:border-0 ${onRow ? "cursor-pointer hover:bg-slate-50" : ""}`}>
              {columns.map((c, i) => (
                <td key={i}className={`py-2.5 pr-3 align-top ${c.right ? "text-right tabular-nums" : ""}`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Key/value rows for a detail view. */
export function Facts({ items }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
      {items.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10px] font-bold uppercase text-slate-400">{k}</dt>
          <dd className="text-sm font-semibold text-slate-800 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Uploaded documents as thumbnails that open full size. */
export function DocumentGrid({ documents = {} }) {
  const entries = Object.entries(documents).filter(([, url]) => url);
  if (!entries.length) return <p className="text-xs text-slate-400">No documents uploaded.</p>;
  const label = (k) => k.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {entries.map(([k, url]) => (
        <a key={k} href={url} target="_blank" rel="noreferrer noopener" className="block rounded-xl border border-slate-200 overflow-hidden hover:border-blue-400">
          <img src={url} alt={label(k)} loading="lazy" className="w-full h-24 object-cover bg-slate-100" />
          <div className="px-2 py-1.5 text-[11px] font-bold text-slate-600 truncate">{label(k)}</div>
        </a>
      ))}
    </div>
  );
}

/** Badge colour for a food order status. */
export const orderBadge = (s) => (s === "delivered" ? "approved" : /^cancel/.test(s || "") ? "rejected" : "pending");

export const date =(d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");
