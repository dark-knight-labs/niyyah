import type { Metadata } from "next";
// Self-hosted fonts via fontsource (the CI build network cannot reach Google Fonts).
// Geist and Geist Mono are the interface and data faces; Fraunces is the display serif.
// Public Sans and JetBrains Mono stay only for the 24-hour clock and the Now card, whose look is fixed.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/public-sans";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/fraunces/300.css";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/500.css";
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
