"use client";

import { useSession } from "next-auth/react";
import { useSessionTimeoutSimple } from "@/hooks/use-session-timeout-simple";

/**
 * 会话超时管理 Provider（简化版）
 * 基于本地活动时间检查，无需后端验证，减少网络请求和资源消耗
 * 仅在用户登录时启用
 */
export function SessionTimeoutProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";

  // 使用简化的会话超时检查（仅登录用户）
  useSessionTimeoutSimple(isLoggedIn);

  return <>{children}</>;
}

