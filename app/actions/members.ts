"use server";

import { cookies } from "next/headers";
import { EMAIL_RE, KEY_COOKIE, currentMemberId, setMemberCookie } from "@/lib/members/auth";
import { adminClient, createMember, foldMember, keyInfo, memberNumber, mintKeys, redeemKey } from "@/lib/members/store";
import { POINTS, type ScoreKind } from "@/lib/members/tag";
import { weekEndsAt, weekKey } from "@/lib/bar/week";

// Membership, the Sombra list, and the weekly board's scoring. Identity is the
// signed httpOnly member cookie — the client never says who it is. Every action
// returns quietly (null / ok:false) when membership isn't configured, so the bar
// never breaks over it.

export type KnockResult = {
  number: number;
  /** first knock: a new number was handed out */
  isNew: boolean;
  /** a hand-off key moved an existing membership to this device (#002 → Paula) */
  handoff: boolean;
};

/** Called right after the knock (never awaited before audio): who is this? A
 *  hand-off link takes over this device; else a returning member is
 *  recognised; else a waiting invite is redeemed and the next number handed out. */
export async function knockIn(): Promise<KnockResult | null> {
  const sb = adminClient();
  if (!sb) return null;
  const jar = await cookies();

  const known = await currentMemberId();

  // A hand-off link (#002 → Paula) wins even over an existing membership: if
  // this phone already knocked as someone else, that number folds into it.
  const waiting = jar.get(KEY_COOKIE)?.value;
  const handoff = waiting ? await keyInfo(waiting) : null;
  if (waiting && handoff?.claims && (await redeemKey(waiting, handoff.claims))) {
    jar.delete(KEY_COOKIE);
    const n = await memberNumber(handoff.claims);
    if (n !== null) {
      if (known && known !== handoff.claims) await foldMember(known, handoff.claims);
      await setMemberCookie(handoff.claims);
      return { number: n, isNew: false, handoff: true };
    }
  }

  if (known) {
    const n = await memberNumber(known);
    if (n !== null) {
      await sb.from("hallu_members").update({ last_seen_at: new Date().toISOString() }).eq("id", known);
      jar.delete(KEY_COOKIE); // already a member: someone else's key stays unused
      return { number: n, isNew: false, handoff: false };
    }
  }

  // an ordinary invite (hand-offs were handled above)
  const code = jar.get(KEY_COOKIE)?.value;
  jar.delete(KEY_COOKIE);
  const key = code ? await keyInfo(code) : null;

  const m = await createMember(key?.ownerId ?? null);
  if (!m) return null;
  if (key?.ownerId && code) await redeemKey(code, m.id);
  await setMemberCookie(m.id);
  return { number: m.number, isNew: true, handoff: false };
}

export type Membership = {
  number: number;
  keys: { code: string; used: boolean }[];
  broughtIn: number;
  onList: boolean;
};

/** For the fit panel: your number, your keys, who you've brought in, the list. */
export async function myMembership(): Promise<Membership | null> {
  const sb = adminClient();
  const id = await currentMemberId();
  if (!sb || !id) return null;
  const n = await memberNumber(id);
  if (n === null) return null;
  const [{ data: keys }, { data: list }] = await Promise.all([
    sb.from("hallu_keys").select("code, redeemed_by, claims_member").eq("owner_id", id).order("created_at"),
    sb.from("sombra_list").select("id").eq("member_id", id).limit(1),
  ]);
  const own = (keys ?? []).filter((k) => !k.claims_member);
  return {
    number: n,
    keys: own.map((k) => ({ code: k.code as string, used: !!k.redeemed_by })),
    broughtIn: own.filter((k) => k.redeemed_by).length,
    onList: !!list?.length,
  };
}

/** "Stay close to the room." Adds the email to the Sombra list. */
export async function joinList(email: string): Promise<{ ok: boolean; message?: string }> {
  const sb = adminClient();
  if (!sb) return { ok: false, message: "The list isn't open yet. Try again soon." };
  const clean = email.trim().toLowerCase();
  if (clean.length > 254 || !EMAIL_RE.test(clean))
    return { ok: false, message: "That email doesn't look right. Check it and try again." };
  const id = await currentMemberId();
  const { error } = await sb
    .from("sombra_list")
    .upsert({ email: clean, member_id: id, source: "hallucinate" }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return { ok: false, message: "Couldn't save that just now. Try again in a moment." };
  return { ok: true };
}

/** Score one action on this week's board. The same thing scores once a week;
 *  a burst faster than a person can dig is dropped. */
export async function scoreAction(kind: ScoreKind, ref: string): Promise<void> {
  const sb = adminClient();
  const id = await currentMemberId();
  if (!sb || !id || !(kind in POINTS) || kind === "set" || !ref || ref.length > 200) return;
  const since = new Date(Date.now() - 10_000).toISOString();
  const { count } = await sb
    .from("hallu_events")
    .select("id", { count: "exact", head: true })
    .eq("member_id", id)
    .gte("created_at", since);
  if ((count ?? 0) >= 4) return;
  await sb
    .from("hallu_events")
    .upsert(
      { member_id: id, kind, ref, week: weekKey(), points: POINTS[kind] },
      { onConflict: "member_id,kind,ref,week", ignoreDuplicates: true }
    );
}

/** You stayed for an ON AIR set: once per set, +1 key and set points. */
export async function earnSetKey(liveStartedAt: number): Promise<{ ok: boolean }> {
  const sb = adminClient();
  const id = await currentMemberId();
  const age = Date.now() - liveStartedAt;
  if (!sb || !id || !Number.isFinite(liveStartedAt) || age < 0 || age > 12 * 3600_000) return { ok: false };
  const { data } = await sb
    .from("hallu_events")
    .upsert(
      { member_id: id, kind: "set", ref: String(liveStartedAt), week: weekKey(), points: POINTS.set },
      { onConflict: "member_id,kind,ref,week", ignoreDuplicates: true }
    )
    .select("id");
  if (!data?.length) return { ok: false }; // already earned for this set
  const { data: m } = await sb.from("hallu_members").select("keys_earned").eq("id", id).single();
  await sb.from("hallu_members").update({ keys_earned: ((m?.keys_earned as number) ?? 0) + 1 }).eq("id", id);
  await mintKeys(id, 1);
  return { ok: true };
}

export type BoardRow = { number: number; digs: number; trinkets: number; score: number };
export type WeekBoard = {
  week: number;
  /** when this week's board resets (Friday noon in Austin), ms */
  endsAt: number;
  /** this week's leaders, by score (top 20) */
  top: BoardRow[];
  /** you, with your place by score (null place = not in the top 20 yet) */
  me: (BoardRow & { place: number | null }) | null;
};

/** The weekly board: the bartender's gossip and the whiteboard by the sign. */
export async function weekBoard(): Promise<WeekBoard | null> {
  const sb = adminClient();
  if (!sb) return null;
  const week = weekKey();
  const { data, error } = await sb.rpc("hallu_board", { w: week });
  if (error) return null;
  const top: BoardRow[] = ((data ?? []) as Record<string, number | string>[]).map((r) => ({
    number: Number(r.number),
    digs: Number(r.digs),
    trinkets: Number(r.trinkets),
    score: Number(r.score),
  }));
  let me: WeekBoard["me"] = null;
  const id = await currentMemberId();
  const n = id ? await memberNumber(id) : null;
  if (id && n !== null) {
    const i = top.findIndex((r) => r.number === n);
    if (i >= 0) me = { ...top[i], place: i + 1 };
    else {
      const { data: ev } = await sb.from("hallu_events").select("kind, points").eq("member_id", id).eq("week", week);
      const rows = ev ?? [];
      me = {
        number: n,
        digs: rows.filter((e) => e.kind === "dig").length,
        trinkets: rows.filter((e) => e.kind === "gift").length,
        score: rows.reduce((s, e) => s + (e.points as number), 0),
        place: null,
      };
    }
  }
  return { week, endsAt: weekEndsAt(week), top, me };
}
