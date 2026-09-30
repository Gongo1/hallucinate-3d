import type { Metadata } from "next";
import { keyInfo, memberNumber } from "@/lib/members/store";
import { memberTag } from "@/lib/members/tag";
import KeyRedirect from "./KeyRedirect";

// An invite link: /k/<code>. Link previews (iMessage, WhatsApp, IG DMs) read this
// page's tags and show the door with "#002 saved you a key" (opengraph-image.tsx
// beside it). A person is sent straight on to /k/<code>/enter, which leaves the
// key at the door and redirects to the bar.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

async function headline(code: string): Promise<string> {
  const k = await keyInfo(code.toUpperCase()).catch(() => null);
  if (k?.claims) {
    const n = await memberNumber(k.claims).catch(() => null);
    if (n) return `${memberTag(n)} is waiting for you`;
  }
  if (k?.ownerNumber) return `${memberTag(k.ownerNumber)} saved you a key`;
  return "A key to the Sombra Listening Room";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const title = await headline(code);
  const description = "Knock, and the door slides open. HALLUCINATE · the Sombra Listening Room.";
  return {
    title: `${title} · HALLUCINATE`,
    description,
    openGraph: { title, description, siteName: "HALLUCINATE", type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: false },
  };
}

export default async function KeyPage({ params }: Props) {
  const { code } = await params;
  return <KeyRedirect to={`/k/${encodeURIComponent(code)}/enter`} line={await headline(code)} />;
}
