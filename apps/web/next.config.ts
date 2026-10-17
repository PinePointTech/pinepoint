import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source. Next compiles them.
  transpilePackages: [
    "@pinepoint/ai",
    "@pinepoint/core",
    "@pinepoint/github",
    "@pinepoint/runner",
  ],
};

export default nextConfig;
