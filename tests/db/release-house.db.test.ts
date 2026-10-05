import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect, dockerAvailable, freshDb } from "./pg";

// The 2026-10-05 data fix, run exactly as written: house copies go back to
// their crate (logged as 'reset'); everything else is untouched.
const SEED = `
  insert into shelves (id, slug, label) values
    ('00000000-0000-0000-0000-0000000000a1', 'gongo', 'GONGO'),
    ('00000000-0000-0000-0000-0000000000a2', 'sombra-selection', 'SELECTION'),
    ('00000000-0000-0000-0000-0000000000a3', 'this-week', 'THIS WEEK');
  insert into records (shelf_id, title, artist, yt_id) values
    ('00000000-0000-0000-0000-0000000000a1', 'Set', 'Gongo', 'setYT'),
    ('00000000-0000-0000-0000-0000000000a2', 'Pick', 'S', 'pickYT'),
    ('00000000-0000-0000-0000-0000000000a3', 'Pick', 'S', 'pickYT'),
    ('00000000-0000-0000-0000-0000000000a3', 'Fresh', 'W', 'weekYT');
`;
const sql = (f: string) => readFileSync(path.resolve(__dirname, "../../supabase", f), "utf8");

const run = dockerAvailable() ? describe : describe.skip;
let db: Client;

run("releasing house copies (data fix 2026-10-05)", () => {
  beforeAll(async () => {
    await freshDb(SEED);
    db = await connect();
    await db.query(sql("migrations/20261005_copy_reset_kind.sql"));
  });
  afterAll(async () => db?.end());

  it("puts held house copies back with a 'reset' event, leaves other copies alone, and re-runs cleanly", async () => {
    const { rows: [m] } = await db.query("insert into hallu_members default values returning id");
    for (const key of ["yt:setYT", "yt:pickYT", "yt:weekYT"]) {
      const { rows: [c] } = await db.query("select id from hallu_copies where track_key = $1 and serial = 1", [key]);
      expect((await db.query("select hallu_claim_copy($1, $2, 8) as r", [m.id, c.id])).rows[0].r).toBe("ok");
    }
    const fix = sql("data-fixes/2026-10-05_release_house_copies.sql");
    await db.query(fix);

    const { rows: held } = await db.query("select track_key from hallu_copies where owner_id = $1", [m.id]);
    expect(held.map((r) => r.track_key)).toEqual(["yt:weekYT"]); // This Week isn't a house crate
    const { rows: resets } = await db.query("select from_member from hallu_copy_events where kind = 'reset'");
    expect(resets).toHaveLength(2);
    expect(resets.every((r) => r.from_member === m.id)).toBe(true);
    const { rows: back } = await db.query(
      "select count(*)::int as n from hallu_copies where track_key in ('yt:setYT', 'yt:pickYT') and owner_id is null and claimed_at is null"
    );
    expect(back[0].n).toBe(6); // all three copies of each are in their crate again

    await db.query(fix); // re-run: nothing left to release
    expect((await db.query("select count(*)::int as n from hallu_copy_events where kind = 'reset'")).rows[0].n).toBe(2);
  });
});
