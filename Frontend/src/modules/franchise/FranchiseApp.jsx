import React, { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { session, whenSignedOut } from "./api";
import PortalLayout from "./PortalLayout";
import { Loading } from "@food/pages/admin/franchise/finance/ui";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Riders = lazy(() => import("./pages/Riders"));
const Drivers = lazy(() => import("./pages/Drivers"));
const Orders = lazy(() => import("./pages/Orders"));
const Restaurants = lazy(() => import("./pages/Restaurants"));
const TaxiRides = lazy(() => import("./pages/TaxiRides"));
const Money = lazy(() => import("./pages/Money"));
const Support = lazy(() => import("./pages/Support"));
const RefundClaims = lazy(() => import("./pages/RefundClaims"));

/** Signed-in pages; anyone else goes to the login with a way back. */
function RequireSession({ children }) {
  const location = useLocation();
  if (!session.signedIn) {
    return <Navigate to="/franchise/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

/** A franchise holds food, taxi or both; pages of a module it does not hold are not shown. */
function RequireModule({ module, children }) {
  const modules = session.user?.franchise?.modules || [];
  const holds = modules.some((m) => (module === "taxi" ? String(m).startsWith("taxi") : m === module));
  return holds ? children : <Navigate to="/franchise" replace />;
}

export default function FranchiseApp() {
  const navigate = useNavigate();
  // Suspended, locked out or logged out in another tab: back to the login.
  useEffect(() => whenSignedOut(() => navigate("/franchise/login", { replace: true })), [navigate]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="login" element={session.signedIn ? <Navigate to="/franchise" replace /> : <Login />} />
          <Route element={<RequireSession><PortalLayout /></RequireSession>}>
            <Route index element={<Dashboard />} />
            <Route path="riders" element={<RequireModule module="food"><Riders /></RequireModule>} />
            <Route path="orders" element={<RequireModule module="food"><Orders /></RequireModule>} />
            <Route path="restaurants" element={<RequireModule module="food"><Restaurants /></RequireModule>} />
            <Route path="refund-claims" element={<RequireModule module="food"><RefundClaims /></RequireModule>} />
            <Route path="drivers" element={<RequireModule module="taxi"><Drivers /></RequireModule>} />
            <Route path="rides" element={<RequireModule module="taxi"><TaxiRides /></RequireModule>} />
            <Route path="money" element={<Money />} />
            <Route path="support" element={<Support />} />
          </Route>
          <Route path="*" element={<Navigate to="/franchise" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
