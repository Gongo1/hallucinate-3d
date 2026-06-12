import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client. Prefers the service-role key (which bypasses RLS)
// for writes; falls back to the anon key, which RLS still permits during Phase 1
// (public insert). The service key is read from a NON-NEXT_PUBLIC env var, so it
// never enters the client bundle — and this module imports "server-only" to make
// any accidental client import a hard build error. See CLAUDE.md (no secrets in
// the client bundle).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

export function getServerClient(): SupabaseClient {
  if (cached) return cached;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  const key = serviceKey ?? anonKey;
  if (!key)
    throw new Error(
      "No Supabase key set (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
