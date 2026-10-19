import type { NextConfig } from "next";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

// Neon-Env liegt zentral im Repo-Root (../.env), verwaltet von `neon env pull`.
loadDotenv({ path: resolve(process.cwd(), "..", ".env") });

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  turbopack: {
    root: resolve(process.cwd()),
  },
  agentRules: false,
};

export default nextConfig;
