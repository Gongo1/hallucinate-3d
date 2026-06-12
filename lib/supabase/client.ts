"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client (anon key only — safe to ship). Used for Realtime
// presence + broadcast in the lobby; reads/writes still go through server
// actions. Singleton so we open one Realtime socket per tab.

let client: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error("Supabase public env vars are not set in the client bundle");
  client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}
