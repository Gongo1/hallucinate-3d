"use client";

import { useEffect } from "react";

/** People don't linger here: straight on to the door (crawlers keep the tags). */
export default function KeyRedirect({ to, line }: { to: string; line: string }) {
  useEffect(() => {
    location.replace(to);
  }, [to]);
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#120d08", color: "#f3e6c8", fontFamily: "Shippori Mincho, serif", textAlign: "center", padding: 24 }}>
      <div>
        <p style={{ fontSize: 22, margin: 0 }}>{line}</p>
        <p style={{ fontFamily: "DM Mono, monospace", fontSize: 12, opacity: 0.7 }}>
          <a href={to} style={{ color: "#ffb35e" }}>to the door →</a>
        </p>
      </div>
    </main>
  );
}
