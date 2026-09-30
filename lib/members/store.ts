import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { newKeyCode, KEY_CODE_RE } from "./auth";

// Membership data access. These tables have RLS on and no public policies, so
// only the service-role client can touch them. Without the key (local dev
// without it pulled) every function degrades to "no membership" instead of
// throwing — the bar itself must never break over membership.

let cached: SupabaseClient | null = null;
export function adminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export const STARTING_KEYS = 3;

/** The member's number, or null if the id is unknown (or membership is off). */
export async function memberNumber(id: string): Promise<number | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data } = await sb.from("hallu_members").select("number").eq("id", id).maybeSingle();
  return (data?.number as number | undefined) ?? null;
}

/** A still-unused invite: who sent it (their number), or a hand-off. */
export async function keyInfo(
  code: string
): Promise<{ ownerId: string | null; ownerNumber: number | null; claims: string | null } | null> {
  const sb = adminClient();
  if (!sb || !KEY_CODE_RE.test(code)) return null;
  const { data } = await sb
    .from("hallu_keys")
    .select("owner_id, claims_member, redeemed_by")
    .eq("code", code)
    .maybeSingle();
  if (!data || data.redeemed_by) return null;
  const ownerId = (data.owner_id as string | null) ?? null;
  return {
    ownerId,
    ownerNumber: ownerId ? await memberNumber(ownerId) : null,
    claims: (data.claims_member as string | null) ?? null,
  };
}

/** Mark a key used — atomic, so two people can't redeem the same key. */
export async function redeemKey(code: string, by: string): Promise<boolean> {
  const sb = adminClient();
  if (!sb) return false;
  const { data } = await sb
    .from("hallu_keys")
    .update({ redeemed_by: by, redeemed_at: new Date().toISOString() })
    .eq("code", code)
    .is("redeemed_by", null)
    .select("code");
  return !!data?.length;
}

/** Mint `n` fresh keys for a member. */
export async function mintKeys(ownerId: string, n: number): Promise<void> {
  const sb = adminClient();
  if (!sb || n <= 0) return;
  const rows = Array.from({ length: n }, () => ({ code: newKeyCode(), owner_id: ownerId }));
  await sb.from("hallu_keys").insert(rows);
}

/** A brand-new member (next number), with their starting keys. */
export async function createMember(invitedBy: string | null): Promise<{ id: string; number: number } | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("hallu_members")
    .insert({ invited_by: invitedBy })
    .select("id, number")
    .single();
  if (error || !data) return null;
  await mintKeys(data.id as string, STARTING_KEYS);
  return { id: data.id as string, number: data.number as number };
}

/** Fold a throwaway membership into another (a founding number being claimed
 *  on a device that already knocked as someone else): its points and list
 *  signup move over, its unused keys go, and the row is deleted unless someone
 *  joined through it. Then the number sequence rewinds so no number is left
 *  held by nobody. */
export async function foldMember(fromId: string, toId: string): Promise<void> {
  const sb = adminClient();
  if (!sb || fromId === toId) return;
  const { data: from } = await sb.from("hallu_members").select("number").eq("id", fromId).maybeSingle();
  if (!from || (from.number as number) <= 2) return; // never fold a founding number away
  await sb.from("hallu_events").update({ member_id: toId }).eq("member_id", fromId);
  await sb.from("sombra_list").update({ member_id: toId }).eq("member_id", fromId);
  await sb.from("hallu_keys").delete().eq("owner_id", fromId).is("redeemed_by", null);
  const { count } = await sb
    .from("hallu_members")
    .select("id", { count: "exact", head: true })
    .eq("invited_by", fromId);
  if ((count ?? 0) > 0) return; // someone came in on its key: keep the row
  await sb.from("hallu_keys").delete().eq("owner_id", fromId);
  await sb.from("hallu_members").delete().eq("id", fromId);
  await sb.rpc("hallu_rewind_numbers"); // no-op error if the function isn't installed yet
}
