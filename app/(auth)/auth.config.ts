import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
    newUser: "/",
    error: "/login", // 错误时重定向到登录页
  },
  providers: [
    // added later in auth.ts since it requires bcrypt which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
  callbacks: {
    // 可以在这里添加额外的回调逻辑
  },
  // 安全配置
  session: {
    strategy: "jwt", // 使用 JWT 策略（推荐）
    maxAge: 30 * 24 * 60 * 60, // 30天
  },
  // 启用调试模式（开发环境）
  debug: process.env.NODE_ENV === "development",
  // 信任代理（Cloudflare 等反向代理）
  trustHost: true,
} satisfies NextAuthConfig;
