import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bcryptjs"],
  poweredByHeader: false,
};

export default nextConfig;
