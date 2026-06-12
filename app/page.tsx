import Bar from "@/components/Bar";
import { loadShelves } from "@/lib/bar/data";

// Read the live library from Supabase on every request so freshly ingested
// records survive a reload (the Phase 1 "done when").
export const dynamic = "force-dynamic";

export default async function Home() {
  const shelves = await loadShelves();
  return <Bar initialShelves={shelves} />;
}
