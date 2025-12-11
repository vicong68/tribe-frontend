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
  // 启用组件缓存，提升性能
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
      // ✅ 允许从 localhost 和 127.0.0.1 加载图片（开发环境）
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "9000",
        pathname: "/**",
      },
    ],
    // ✅ Next.js 16 允许从私有 IP 加载图片（开发环境必需）
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // ✅ 开发环境禁用图片优化，避免私有 IP 限制问题
    unoptimized: process.env.NODE_ENV === "development",
  },
  
  // 将 AWS SDK 相关包标记为外部包，避免打包到客户端
  // 参考 Vercel AI SDK 最佳实践：https://sdk.vercel.ai/docs/guides/deployment
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  
  // 优化：启用 React 严格模式，帮助发现潜在问题
  reactStrictMode: true,
  
  // 配置 Server Actions body size limit（支持大文件上传，最大 100MB）
  serverActions: {
    bodySizeLimit: "100mb",
  },
};

export default nextConfig;
