import "server-only";
import { BAR_CHANNEL } from "./commands";

/** Publish an event to the bar's Realtime channel from the server (HTTP
 *  broadcast API). What makes it trustworthy is the signed ticket inside the
 *  payload, not the sender: anyone with the public key can broadcast too. */
export async function serverBroadcast(event: string, payload: Record<string, unknown>): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: BAR_CHANNEL, event, payload }] }),
    });
    return res.status === 202 || res.ok;
  } catch {
    return false;
  }
}
