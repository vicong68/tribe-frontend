"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SESSION_TIMEOUT_CONFIG } from "@/lib/config/session-timeout";
import { getBackendMemberId, updateBackendOnlineStatus } from "@/lib/user-utils";
import { toast } from "@/components/toast";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 会话超时检查 Hook
 * 定期检查会话是否过期，如果过期则自动注销
 */
export function useSessionTimeout(enabled: boolean = true) {
  const { data: session } = useSession();
  const router = useRouter();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const isPageVisibleRef = useRef(true);

  useEffect(() => {
    if (!enabled || !session?.user || session.user.type !== "regular") {
      return;
    }

    const memberId = getBackendMemberId(session.user);
    if (!memberId) {
      return;
    }

    // 检查会话有效性的函数
    const checkSessionValidity = async () => {
      // 如果页面不可见或正在检查中，跳过
      if (!isPageVisibleRef.current || isChecking) {
        return;
      }

      setIsChecking(true);

      try {
        const response = await fetch(
          `${BACKEND_URL}/api/user/session/validate?user_id=${encodeURIComponent(memberId)}&timeout_minutes=45`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          // 如果请求失败，不进行自动注销（可能是网络问题）
          setIsChecking(false);
          return;
        }

        const data = await response.json();

        if (!data.valid) {
          // 会话已过期，执行自动注销
          setIsChecking(false);

          // 显示提示信息
          toast({
            type: "info",
            description: "由于长时间未活动，您已被自动注销",
          });

          // 更新后端状态
          await updateBackendOnlineStatus(memberId, false).catch(() => {
            // 错误已在函数内部处理
          });

          // 执行注销
          await signOut({
            redirectTo: "/",
          });

          // 清理定时器
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
        } else {
          setIsChecking(false);
        }
      } catch (error) {
        // 静默处理错误，不影响用户体验
        setIsChecking(false);
        if (process.env.NODE_ENV === "development") {
          console.warn("[SessionTimeout] Error checking session:", error);
        }
      }
    };

    // 立即检查一次
    checkSessionValidity();

    // 设置定时器，定期检查会话有效性
    intervalRef.current = setInterval(
      checkSessionValidity,
      SESSION_TIMEOUT_CONFIG.CHECK_INTERVAL
    );

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      isPageVisibleRef.current = document.visibilityState === "visible";
      // 页面变为可见时，立即检查一次
      if (isPageVisibleRef.current) {
        checkSessionValidity();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 清理函数
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, session, router, isChecking]);
}

