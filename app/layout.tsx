import type { Metadata, Viewport } from "next";
import "./globals.css";

// Canonical home is now the Sombra subdomain (the *.vercel.app URL keeps working).
// OG/canonical point there so shared links preview + resolve correctly.
const SITE_URL = "https://hallucinate.sombraproject.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "HALLUCINATE · the Sombra Listening Room",
  description:
    "The Sombra Listening Room — a walk-around, low-poly listening bar where you dig for house records, meet the keepers, and hear the same track as everyone in the room.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "HALLUCINATE · the Sombra Listening Room",
    description:
      "The Sombra Listening Room — dig for records, meet the keepers, step through the ☉☽.",
    url: SITE_URL,
    siteName: "HALLUCINATE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HALLUCINATE · the Sombra Listening Room",
    description: "The Sombra Listening Room — dig for records in a low-poly listening bar.",
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
