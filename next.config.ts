import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All prototype data lives in the browser (localStorage), so pages are
  // client rendered. Cache Components is intentionally off until a real
  // database and server data loading are introduced.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
