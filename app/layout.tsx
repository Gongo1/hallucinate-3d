import type { Metadata, Viewport } from "next";
import "./globals.css";

// Canonical home is now the Sombra subdomain (the *.vercel.app URL keeps working).
// OG/canonical point there so shared links preview + resolve correctly.
const SITE_URL = "https://hallucinate.sombraproject.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "HALLUCINATE · 音楽喫茶 — a listening bar",
  description:
    "Sombra presents a walk-around Japanese listening bar — a playable front-end for discovering electronic music on YouTube & SoundCloud.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "HALLUCINATE · 音楽喫茶 — a listening bar",
    description:
      "Sombra presents a walk-around Japanese listening bar — step through the ☉☽ and into the room.",
    url: SITE_URL,
    siteName: "HALLUCINATE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HALLUCINATE · 音楽喫茶 — a listening bar",
    description: "Sombra presents a walk-around Japanese listening bar.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale 1 also suppresses iOS's auto-zoom on small input focus
  maximumScale: 1,
  userScalable: false,
  // edge-to-edge on notched phones; the UI pads itself with safe-area insets
  viewportFit: "cover",
  themeColor: "#120d08",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Display: Shippori Mincho · Labels: Anton · UI: DM Mono */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;800&family=Anton&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
