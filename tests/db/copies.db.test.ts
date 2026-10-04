import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { STARTER_CAPACITY } from "@/lib/collection/rules";
import { connect, dockerAvailable, freshDb, migrationSql } from "./pg";

// The catalog the migration backfills from: one track filed in two crates, one
// SoundCloud track written two ways, and a plain YouTube track.
const SEED = `
  insert into shelves (id, slug, label) values
    ('00000000-0000-0000-0000-00000000000a', 'house', 'HOUSE'),
    ('00000000-0000-0000-0000-00000000000b', 'this-week', 'THIS WEEK');
  insert into records (shelf_id, title, artist, yt_id, sc_url) values
    ('00000000-0000-0000-0000-00000000000a', 'Twice Filed', 'A', 'dupYT', null),
    ('00000000-0000-0000-0000-00000000000b', 'Twice Filed', 'A', 'dupYT', null),
    ('00000000-0000-0000-0000-00000000000a', 'SC One', 'B', null, 'https://soundcloud.com/artist/one?si=abc'),
    ('00000000-0000-0000-0000-00000000000b', 'SC One again', 'B', null, 'soundcloud.com/Artist/one/'),
    ('00000000-0000-0000-0000-00000000000a', 'Plain', 'C', 'plainYT', null);
`;

const run = dockerAvailable() ? describe : describe.skip;
if (!dockerAvailable()) console.warn("⚠ Docker isn't running: skipping the collectible DB tests");

let db: Client;

async function member(): Promise<string> {
  const { rows } = await db.query("insert into hallu_members default values returning id");
  return rows[0].id as string;
}
async function addTrack(yt: string, title = yt): Promise<string> {
  await db.query(
    "insert into records (shelf_id, title, artist, yt_id) values ('00000000-0000-0000-0000-00000000000a', $1, 'X', $2)",
    [title, yt]
  );
  return `yt:${yt}`;
}
async function copiesOf(key: string): Promise<{ id: string; serial: number; owner_id: string | null }[]> {
  const { rows } = await db.query("select id, serial, owner_id from hallu_copies where track_key = $1 order by serial", [key]);
  return rows;
}
async function claim(c: Client, m: string, copy: string, cap = STARTER_CAPACITY): Promise<string> {
  const { rows } = await c.query("select hallu_claim_copy($1, $2, $3) as r", [m, copy, cap]);
  return rows[0].r as string;
}
/** Claim inside an open transaction that lingers before committing, so every
 *  contender gets past the pre-checks and meets at the row lock: a real race. */
async function racingClaim(m: string, copy: string, cap = STARTER_CAPACITY): Promise<string> {
  const c = await connect();
  try {
    await c.query("begin");
    const r = await claim(c, m, copy, cap);
    await c.query("select pg_sleep(0.3)");
    await c.query("commit");
    return r;
  } finally {
    await c.end();
  }
}

run("collectible copies (Postgres)", () => {
  beforeAll(async () => {
    await freshDb(SEED); // starts the container on first use
    db = await connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  describe("three-copy uniqueness", () => {
    beforeAll(async () => {
      await db.end();
      await freshDb(SEED);
      db = await connect();
    });

    it("backfills exactly three numbered copies per distinct track", async () => {
      const { rows } = await db.query(
        "select track_key, array_agg(serial order by serial) s from hallu_copies group by track_key order by track_key"
      );
      expect(rows).toEqual([
        { track_key: "sc:soundcloud.com/artist/one", s: [1, 2, 3] },
        { track_key: "yt:dupYT", s: [1, 2, 3] },
        { track_key: "yt:plainYT", s: [1, 2, 3] },
      ]);
    });

    it("a track filed in two crates shares one set of copies", async () => {
      const { rows } = await db.query("select count(*)::int n from records where track_key = 'yt:dupYT'");
      expect(rows[0].n).toBe(2);
      expect(await copiesOf("yt:dupYT")).toHaveLength(3);
    });

    it("re-running the migration mints nothing new", async () => {
      const before = (await db.query("select count(*)::int n from hallu_copies")).rows[0].n;
      await db.query(migrationSql());
      const after = (await db.query("select count(*)::int n from hallu_copies")).rows[0].n;
      expect(after).toBe(before);
    });

    it("a new track mints three copies; another record of a known track mints none", async () => {
      const key = await addTrack("freshYT");
      expect((await copiesOf(key)).map((c) => c.serial)).toEqual([1, 2, 3]);
      await addTrack("freshYT", "filed again");
      expect(await copiesOf(key)).toHaveLength(3);
    });

    it("re-pointing a record at a new source mints that track's copies", async () => {
      await db.query("update records set yt_id = 'movedYT' where yt_id = 'plainYT'");
      expect(await copiesOf("yt:movedYT")).toHaveLength(3);
    });

    it("a record with no source still inserts (and mints nothing)", async () => {
      await db.query("insert into records (title) values ('no source')");
      const { rows } = await db.query("select count(*)::int n from hallu_copies where track_key is null");
      expect(rows[0].n).toBe(0);
    });

    it("the schema refuses a fourth copy or a duplicate serial", async () => {
      await expect(
        db.query("insert into hallu_copies (track_key, serial) values ('yt:dupYT', 4)")
      ).rejects.toThrow(/check/);
      await expect(
        db.query("insert into hallu_copies (track_key, serial) values ('yt:dupYT', 2)")
      ).rejects.toThrow(/duplicate key/);
    });

    it("minting is logged once per copy", async () => {
      const { rows } = await db.query(
        "select count(*)::int n, count(distinct copy_id)::int d from hallu_copy_events where kind = 'mint'"
      );
      const total = (await db.query("select count(*)::int n from hallu_copies")).rows[0].n;
      expect(rows[0]).toEqual({ n: total, d: total });
    });
  });

  describe("claims", () => {
    beforeEach(async () => {
      await db.end();
      await freshDb(SEED);
      db = await connect();
    });

    it("a claim moves that copy out of the crate and into the player's collection", async () => {
      const a = await member();
      const [c1] = await copiesOf("yt:plainYT");
      expect(await claim(db, a, c1.id)).toBe("ok");
      const left = await db.query("select serial from hallu_copies where track_key = 'yt:plainYT' and owner_id is null");
      expect(left.rows.map((r) => r.serial)).toEqual([2, 3]);
      const mine = await db.query("select id from hallu_copies where owner_id = $1", [a]);
      expect(mine.rows.map((r) => r.id)).toEqual([c1.id]);
    });

    it("duplicate claims: the same copy twice, or a second copy of a track you hold", async () => {
      const a = await member();
      const [c1, c2] = await copiesOf("yt:plainYT");
      expect(await claim(db, a, c1.id)).toBe("ok");
      expect(await claim(db, a, c1.id)).toBe("owned");
      expect(await claim(db, a, c2.id)).toBe("owned");
      const { rows } = await db.query("select count(*)::int n from hallu_copy_events where kind = 'claim'");
      expect(rows[0].n).toBe(1);
    });

    it("someone else's copy is gone; unknown copies and members are refused", async () => {
      const a = await member();
      const b = await member();
      const [c1] = await copiesOf("yt:plainYT");
      expect(await claim(db, a, c1.id)).toBe("ok");
      expect(await claim(db, b, c1.id)).toBe("gone");
      expect(await claim(db, b, "00000000-0000-0000-0000-000000000000")).toBe("gone");
      expect(await claim(db, "00000000-0000-0000-0000-000000000000", c1.id)).toBe("no_member");
    });

    it("simultaneous claims of one copy: exactly one player wins", async () => {
      const [c1] = await copiesOf("yt:plainYT");
      const players: string[] = [];
      for (let i = 0; i < 10; i++) players.push(await member());
      const results = await Promise.all(players.map((m) => racingClaim(m, c1.id)));
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
      expect(results.filter((r) => r === "gone")).toHaveLength(9);
      const winner = players[results.indexOf("ok")];
      expect((await copiesOf("yt:plainYT"))[0].owner_id).toBe(winner);
      const { rows } = await db.query("select count(*)::int n from hallu_copy_events where kind = 'claim'");
      expect(rows[0].n).toBe(1);
    });

    it("simultaneous claims of two copies of one track by the same player: only one lands", async () => {
      const a = await member();
      const [c1, c2] = await copiesOf("yt:plainYT");
      const results = await Promise.all([racingClaim(a, c1.id), racingClaim(a, c2.id)]);
      expect(results.sort()).toEqual(["ok", "owned"]);
      const { rows } = await db.query("select count(*)::int n from hallu_copies where owner_id = $1", [a]);
      expect(rows[0].n).toBe(1);
    });

    it(`starter capacity: ${STARTER_CAPACITY} claims fit, the next is refused`, async () => {
      const a = await member();
      for (let i = 0; i < STARTER_CAPACITY; i++) {
        const [c] = await copiesOf(await addTrack(`cap${i}`));
        expect(await claim(db, a, c.id)).toBe("ok");
      }
      const [extra] = await copiesOf(await addTrack("capExtra"));
      expect(await claim(db, a, extra.id)).toBe("full");
      expect((await copiesOf("yt:capExtra"))[0].owner_id).toBeNull();
    });

    it("capacity holds when one player claims twice at once with one slot left", async () => {
      const a = await member();
      for (let i = 0; i < STARTER_CAPACITY - 1; i++) {
        const [c] = await copiesOf(await addTrack(`fill${i}`));
        expect(await claim(db, a, c.id)).toBe("ok");
      }
      const [x] = await copiesOf(await addTrack("lastA"));
      const [y] = await copiesOf(await addTrack("lastB"));
      const results = await Promise.all([racingClaim(a, x.id), racingClaim(a, y.id)]);
      expect(results.sort()).toEqual(["full", "ok"]);
      const { rows } = await db.query("select count(*)::int n from hallu_copies where owner_id = $1", [a]);
      expect(rows[0].n).toBe(STARTER_CAPACITY);
    });

    it("refresh / reconnect: a fresh connection sees the same crate and collection", async () => {
      const a = await member();
      const [c1] = await copiesOf("sc:soundcloud.com/artist/one");
      expect(await claim(db, a, c1.id)).toBe("ok");
      await db.end();
      db = await connect(); // a new session: nothing cached
      const crate = await db.query(
        "select serial from hallu_copies where track_key = 'sc:soundcloud.com/artist/one' and owner_id is null order by serial"
      );
      expect(crate.rows.map((r) => r.serial)).toEqual([2, 3]);
      const mine = await db.query("select id, serial, title, sc_url from hallu_copies where owner_id = $1", [a]);
      expect(mine.rows).toEqual([
        { id: c1.id, serial: 1, title: "SC One", sc_url: "https://soundcloud.com/artist/one?si=abc" },
      ]);
    });

    it("folding a member moves its copies; a track both hold goes back to the crate", async () => {
      const from = await member();
      const to = await member();
      const [p1, p2] = await copiesOf("yt:plainYT");
      const [d1] = await copiesOf("yt:dupYT");
      expect(await claim(db, from, p1.id)).toBe("ok");
      expect(await claim(db, from, d1.id)).toBe("ok");
      expect(await claim(db, to, p2.id)).toBe("ok");
      await db.query("select hallu_fold_copies($1, $2)", [from, to]);
      const toHas = await db.query("select track_key from hallu_copies where owner_id = $1 order by track_key", [to]);
      expect(toHas.rows.map((r) => r.track_key)).toEqual(["yt:dupYT", "yt:plainYT"]);
      expect((await copiesOf("yt:plainYT"))[0].owner_id).toBeNull(); // p1 went back
    });

    it("a deleted member's copies go back to the crate", async () => {
      const a = await member();
      const [c1] = await copiesOf("yt:plainYT");
      expect(await claim(db, a, c1.id)).toBe("ok");
      await db.query("delete from hallu_members where id = $1", [a]);
      expect((await copiesOf("yt:plainYT"))[0].owner_id).toBeNull();
    });
  });
});
