import { boothStatus } from "@/app/actions/booth";
import BoothClient from "./BoothClient";

// Hidden owner route. Server-renders whether THIS request already holds a valid
// owner session (verified server-side) and hands that to the client. Nothing
// here exposes the secret; an unauthenticated visitor just sees the login form.
export const dynamic = "force-dynamic";

export default async function Booth() {
  const { owner } = await boothStatus();
  return <BoothClient initialOwner={owner} />;
}
