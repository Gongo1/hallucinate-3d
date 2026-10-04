// A throwaway Postgres 16 for the collectible tests (Docker). Each suite gets a
// clean public schema with stand-ins for the tables the migration builds on,
// then the REAL migration file, so the SQL under test is the SQL that ships.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const CONTAINER = "hallu-test-pg";
const PORT = 54329;
export const DB_URL = `postgres://postgres:test@127.0.0.1:${PORT}/postgres`;
const MIGRATION = path.resolve(__dirname, "../../supabase/migrations/20261004_copies.sql");

export function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureContainer() {
  const running = execSync(`docker ps -q -f name=^${CONTAINER}$`).toString().trim();
  if (running) return;
  execSync(`docker rm -f ${CONTAINER}`, { stdio: "ignore" });
  execSync(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -p ${PORT}:5432 postgres:16-alpine`,
    { stdio: "ignore" }
  );
}

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const c = await connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("test Postgres never came up");
}

// what the migration builds on, as it is in Supabase (only the columns used)
const STUBS = `
  drop schema if exists public cascade;
  create schema public;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  create table hallu_members (id uuid primary key default gen_random_uuid(), number serial);
  create table shelves (id uuid primary key default gen_random_uuid(), slug text, label text not null default '');
  create table records (
    id uuid primary key default gen_random_uuid(),
    shelf_id uuid references shelves(id) on delete cascade,
    title text not null,
    artist text,
    yt_id text,
    sc_url text,
    duration_seconds int,
    created_at timestamptz not null default now()
  );
`;

/** Fresh schema; `seed` runs BEFORE the migration (so the backfill sees it). */
export async function freshDb(seed = ""): Promise<void> {
  ensureContainer();
  await waitReady();
  const c = await connect();
  try {
    await c.query(STUBS);
    if (seed) await c.query(seed);
    await c.query(readFileSync(MIGRATION, "utf8"));
  } finally {
    await c.end();
  }
}

export function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8");
}
