import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bike, Car, ClipboardList, Headphones, LayoutDashboard, LogOut, Map, Menu, ReceiptText, Store, Wallet, X } from "lucide-react";
import { franchiseApi, session } from "./api";
import { ServiceChips } from "@food/pages/admin/franchise/finance/ui";

const LINKS = [
  { to: "/franchise", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/franchise/riders", label: "Delivery riders", icon: Bike, module: "food" },
  { to: "/franchise/orders", label: "Food orders", icon: ClipboardList, module: "food" },
  { to: "/franchise/restaurants", label: "Restaurants", icon: Store, module: "food" },
  { to: "/franchise/refund-claims", label: "Refund claims", icon: ReceiptText, module: "food" },
  { to: "/franchise/drivers", label: "Taxi drivers", icon: Car, module: "taxi" },
  { to: "/franchise/rides", label: "Taxi rides", icon: Map, module: "taxi" },
  { to: "/franchise/money", label: "Earnings & wallet", icon: Wallet },
  { to: "/franchise/support", label: "Support", icon: Headphones },
];

const holds = (modules, module) => !module || modules.some((m) => (module === "taxi" ? String(m).startsWith("taxi") : m === module));

export default function PortalLayout() {
  const user = session.user || {};
  const modules = user.franchise?.modules || [];
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const nav = (
    <nav className="flex flex-col gap-1">
      {LINKS.filter((l) => holds(modules, l.module)).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
            isActive ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          <Icon className="w-4 h-4 shrink-0" /> {label}
        </NavLink>
      ))}
    </nav>
  );

  const header = (
    <div className="px-1">
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-blue-600">Raydo Franchise</div>
      <div className="text-base font-black text-slate-900 truncate mt-0.5">{user.franchise?.name || user.name || "Partner"}</div>
      <div className="mt-1.5"><ServiceChips services={modules.map((m) => (String(m).startsWith("taxi") ? "taxi" : m))} /></div>
    </div>
  );

  const signOut = (
    <button onClick={() => franchiseApi.logout()} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-700 w-full">
      <LogOut className="w-4 h-4" /> Sign out
    </button>
  );

  return (
    <div className="lg:flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 shrink-0 bg-white border-r border-slate-200 p-4 gap-6 sticky top-0 h-screen">
        {header}
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {signOut}
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">Raydo Franchise</div>
          <div className="text-sm font-black truncate">{user.franchise?.name || "Partner"}</div>
        </div>
        <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Open menu"><Menu className="w-5 h-5" /></button>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-900/40" onClick={() => setOpen(false)}>
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-white p-4 flex flex-col gap-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              {header}
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Close menu"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {signOut}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
