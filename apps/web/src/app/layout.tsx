import type { Metadata } from "next";
// Self-hosted Manrope (variable) via fontsource — no build-time Google Fonts
// fetch, which the CI build network can't reach.
import "@fontsource-variable/manrope";
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
