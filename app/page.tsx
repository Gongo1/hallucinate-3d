import { cookies } from "next/headers";
import Bar from "@/components/Bar";
import { loadShelves } from "@/lib/bar/data";
import { KEY_COOKIE, MEMBER_COOKIE, readMemberCookie } from "@/lib/members/auth";
import { keyInfo, memberNumber } from "@/lib/members/store";

// Read the live library from Supabase on every request so freshly ingested
// records survive a reload (the Phase 1 "done when").
export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  const [shelves, door] = await Promise.all([loadShelves(), doorGuest(jar)]);
  return <Bar initialShelves={shelves} member={door.member} invite={door.invite} />;
}

/** Who's at the door, from the cookies: a member's number ("Welcome back,
 *  #042") and/or a key they're holding ("#002 saved you a key"). Membership
 *  must never break the bar, so any failure just means an anonymous door. */
async function doorGuest(jar: Awaited<ReturnType<typeof cookies>>) {
  try {
    const id = readMemberCookie(jar.get(MEMBER_COOKIE)?.value);
    const member = id ? await memberNumber(id) : null;
    // a member's door ignores ordinary invites, but a hand-off still shows
    const code = jar.get(KEY_COOKIE)?.value;
    const found = code ? await keyInfo(code) : null;
    const key = found && (!member || found.claims) ? found : null;
    const claim = key?.claims ? await memberNumber(key.claims) : null;
    return { member, invite: key ? { from: key.ownerNumber, claim } : null };
  } catch {
    return { member: null, invite: null };
  }
}
