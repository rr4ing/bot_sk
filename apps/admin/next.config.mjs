import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@builderbot/ui"],
  outputFileTracingRoot: path.join(__dirname, "../..")
};

export default nextConfig;
