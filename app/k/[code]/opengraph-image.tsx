import { ImageResponse } from "next/og";
import { keyInfo, memberNumber } from "@/lib/members/store";
import { memberTag } from "@/lib/members/tag";

// The invite's link preview: the lit shoji door with the sender's number on it.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A key to the Sombra Listening Room";

async function mincho(text: string): Promise<ArrayBuffer | null> {
  // Google Fonts serves TrueType to a plain fetch; satori can't read woff2
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@800&text=${encodeURIComponent(text)}`)
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const k = await keyInfo(code).catch(() => null);
  let line = "A key to the Sombra Listening Room";
  if (k?.claims) {
    const n = await memberNumber(k.claims).catch(() => null);
    if (n) line = `${memberTag(n)} is waiting for you`;
  } else if (k?.ownerNumber) line = `${memberTag(k.ownerNumber)} saved you a key`;
  const title = "HALLUCINATE";
  const font = await mincho(line + title + "SOMBRA PRESENTS");

  const panel = {
    width: 600,
    height: 630,
    display: "flex",
    backgroundColor: "#d9b27c",
    backgroundImage: "radial-gradient(circle at 50% 50%, #f6dcae 0%, #d9b27c 60%, #8f6a3f 100%)",
    border: "14px solid #4f3720",
  } as const;
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative", backgroundColor: "#120d08" }}>
        <div style={panel} />
        <div style={panel} />
        <div
          style={{
            // satori has no `inset`: pin the overlay with explicit box edges
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundImage: "radial-gradient(ellipse 46% 42% at 50% 50%, rgba(246,220,174,0.95) 0%, rgba(246,220,174,0) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#1a120a",
            fontFamily: font ? "Mincho" : undefined,
          }}
        >
          <div style={{ fontSize: 22, letterSpacing: 8, opacity: 0.8 }}>SOMBRA PRESENTS</div>
          <div style={{ fontSize: 96, letterSpacing: 6, marginTop: 8 }}>{title}</div>
          <div style={{ fontSize: 44, marginTop: 22, color: "#8e2a1b" }}>{line}</div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Mincho", data: font, weight: 800, style: "normal" }] : undefined }
  );
}
