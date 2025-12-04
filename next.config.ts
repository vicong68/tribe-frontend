import type { NextConfig } from "next";

// 解析 MinIO 公开 URL
function getMinIOImageConfig() {
  const publicUrl = process.env.MINIO_PUBLIC_URL || "http://localhost:9000";
  try {
    const url = new URL(publicUrl);
    return {
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
    };
  } catch {
    // 如果 URL 解析失败，使用默认配置
    return {
      protocol: "http" as const,
      hostname: "localhost",
    };
  }
}

const minioConfig = getMinIOImageConfig();

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      // MinIO 图片域名配置
      {
        protocol: minioConfig.protocol,
        hostname: minioConfig.hostname,
      },
    ],
  },
  // 将 AWS SDK 相关包标记为外部包，避免打包到客户端
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
};

export default nextConfig;
