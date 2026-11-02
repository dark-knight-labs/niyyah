import type { NextConfig } from "next";

// Pages merged into Overview (/, which holds the calendar) and Plan (/plan). Kept as redirects so bookmarks and Google's return link (?calendar=) still land.
const MOVED = [
  { source: "/routine", destination: "/" },
  { source: "/calendar", destination: "/" },
  { source: "/quarter", destination: "/plan" },
  { source: "/week", destination: "/plan" },
  { source: "/pipelines", destination: "/plan" },
  { source: "/vault", destination: "/progress" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return MOVED.map((m) => ({ ...m, permanent: false }));
  },
};

export default nextConfig;
