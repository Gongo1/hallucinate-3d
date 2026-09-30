"use server";

import { adminClient } from "@/lib/members/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The room's host reports each new track once; the crates show the count.
 *  Repeats of the same record within 3 minutes are ignored server-side. */
export async function notePlay(recordId: string): Promise<void> {
  const sb = adminClient();
  if (!sb || !UUID_RE.test(recordId)) return;
  await sb.rpc("hallu_note_play", { rid: recordId });
}
