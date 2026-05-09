import axios from "axios";
import { supabase } from "./supabase";
import { enqueueSet, flushQueue } from "./offlineQueue";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => Promise.reject(err)
);

/** Wrapper around api.post that, for /sets only, queues offline if network fails.
 * Returns a synthetic response immediately so the UI can update optimistically. */
export async function logSetWithQueue(payload) {
  try {
    const r = await api.post("/sets", payload);
    return { data: r.data, queued: false };
  } catch (e) {
    if (!navigator.onLine || (e?.message && /Network|timeout|ECONNRESET/i.test(e.message))) {
      await enqueueSet(payload);
      // synthesise minimal local set
      const local = {
        ...payload,
        id: `local-${Date.now()}`,
        e1rm: payload.weight * (1 + (payload.reps + (payload.rir || 0)) / 30),
        performed_at: new Date().toISOString(),
        completed: true,
        _offline: true,
      };
      return { data: local, queued: true };
    }
    throw e;
  }
}

// Auto-flush on reconnect
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushQueue((path, body) => api.post(path, body));
  });
}
