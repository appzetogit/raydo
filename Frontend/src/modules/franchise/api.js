import axios from "axios";

/**
 * The franchise partner portal's own API client.
 *
 * Kept apart from the shared client on purpose: that one picks a user, store, rider or
 * admin token from the URL, and a FRANCHISE token must never ride along on any of
 * those APIs (the server refuses it there anyway). This client only ever talks to
 * /auth/franchise/login, /auth/refresh-token and /franchise/*.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const KEYS = { access: "franchise_accessToken", refresh: "franchise_refreshToken", user: "franchise_user" };

function baseUrl() {
  const env = String(import.meta.env?.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!env) return "/api/v1";
  try {
    // A localhost API baked into a deployed build would point at the visitor's own machine.
    const parsed = new URL(env);
    if (LOCAL_HOSTS.has(parsed.hostname) && !LOCAL_HOSTS.has(window.location.hostname)) return "/api/v1";
  } catch {
    /* relative value: use as is */
  }
  return env;
}

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the session lasts until reload */
  }
};

export const session = {
  get user() {
    try {
      return JSON.parse(read(KEYS.user) || "null");
    } catch {
      return null;
    }
  },
  get signedIn() {
    return Boolean(read(KEYS.access));
  },
  save({ accessToken, refreshToken, user }) {
    write(KEYS.access, accessToken);
    if (refreshToken) write(KEYS.refresh, refreshToken);
    if (user) write(KEYS.user, JSON.stringify(user));
  },
  clear() {
    Object.values(KEYS).forEach((k) => write(k, null));
  },
};

const client = axios.create({ baseURL: baseUrl(), timeout: 30000, headers: { "Content-Type": "application/json" } });

client.interceptors.request.use((config) => {
  const token = read(KEYS.access);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// One refresh at a time; every request that hit 401 meanwhile waits for it.
let refreshing = null;
const onSignedOut = new Set();
export const whenSignedOut = (fn) => {
  onSignedOut.add(fn);
  return () => onSignedOut.delete(fn);
};
const signOutLocally = () => {
  session.clear();
  onSignedOut.forEach((fn) => fn());
};

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const isAuthCall = /\/auth\//.test(original.url || "");
    if (status === 401 && !original._retried && !isAuthCall && read(KEYS.refresh)) {
      original._retried = true;
      try {
        refreshing = refreshing || axios
          .post(`${baseUrl()}/auth/refresh-token`, { refreshToken: read(KEYS.refresh) })
          .then((r) => session.save(r.data?.data || {}))
          .finally(() => { refreshing = null; });
        await refreshing;
        return client(original);
      } catch {
        signOutLocally();
      }
    } else if (status === 401 && !isAuthCall) {
      signOutLocally();
    } else if (status === 403 && /not active/i.test(error.response?.data?.message || "") && !isAuthCall) {
      // The franchise was suspended or the login locked while signed in.
      signOutLocally();
    }
    return Promise.reject(error);
  },
);

const data = (p) => p.then((r) => r.data?.data);

export const franchiseApi = {
  async login(email, password) {
    const result = await data(client.post("/auth/franchise/login", { email, password }));
    session.save(result);
    return result;
  },
  async logout() {
    const refreshToken = read(KEYS.refresh);
    try {
      if (refreshToken) await client.post("/auth/logout", { refreshToken });
    } catch {
      /* signing out locally is what matters */
    }
    signOutLocally();
  },

  me: () => data(client.get("/franchise/me")),
  finance: (params) => data(client.get("/franchise/finance", { params })),
  ledger: (params) => data(client.get("/franchise/ledger", { params })),
  sendSupportMessage: (body) => data(client.post("/franchise/support-messages", body)),

  payouts: () => data(client.get("/franchise/payouts")),
  requestPayout: (body) => data(client.post("/franchise/payouts", body)),
  cancelPayout: (requestId) => data(client.post(`/franchise/payouts/${encodeURIComponent(requestId)}/cancel`)),
  savePayee: (body) => data(client.put("/franchise/payee", body)),

  refundClaims: () => data(client.get("/franchise/refund-claims")),
  claimableForOrder: (orderId) => data(client.get(`/franchise/refund-claims/order/${encodeURIComponent(orderId)}`)),
  fileRefundClaim: (body) => data(client.post("/franchise/refund-claims", body)),
  withdrawRefundClaim: (claimId) => data(client.post(`/franchise/refund-claims/${encodeURIComponent(claimId)}/withdraw`)),

  restaurants: (params) => data(client.get("/franchise/restaurants", { params })),
  orders: (params) => data(client.get("/franchise/orders", { params })),
  payments: (params) => data(client.get("/franchise/payments", { params })),
  deliveryFees: () => data(client.get("/franchise/delivery-fees")),
  riders: (params) => data(client.get("/franchise/riders", { params })),
  rider: (id) => data(client.get(`/franchise/riders/${id}`)),
  decideRider: (id, body) => data(client.post(`/franchise/riders/${id}/decision`, body)),

  taxiOverview: () => data(client.get("/franchise/taxi/overview")),
  taxiRides: (params) => data(client.get("/franchise/taxi/rides", { params })),
  taxiBookings: (params) => data(client.get("/franchise/taxi/bookings", { params })),
  taxiDrivers: (params) => data(client.get("/franchise/taxi/drivers", { params })),
  taxiDriver: (id) => data(client.get(`/franchise/taxi/drivers/${id}`)),
  decideTaxiDriver: (id, body) => data(client.post(`/franchise/taxi/drivers/${id}/decision`, body)),
};
