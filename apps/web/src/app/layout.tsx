import type { Metadata } from "next";
// Self-hosted Manrope (variable) via fontsource — no build-time Google Fonts
// fetch, which the CI build network can't reach.
import "@fontsource-variable/manrope";
// Handwritten accent face for journal-style headings/annotations (weights
// used: 400 body, 700 for emphasis) — same self-hosting reasoning as above.
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";
// Elegant display serif for page/section headings (weights used: 300
// light for body headings, 400 for the odd emphasis case).
import "@fontsource/fraunces/300.css";
import "@fontsource/fraunces/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Niyyah - Muslim Productivity",
  description: "Intentional living through Islamic principles",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
