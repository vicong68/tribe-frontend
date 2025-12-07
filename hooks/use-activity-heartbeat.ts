"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { SESSION_TIMEOUT_CONFIG } from "@/lib/config/session-timeout";
import { getBackendMemberId } from "@/lib/user-utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 活动心跳 Hook
 * 定期发送心跳到后端，更新用户最后活动时间
 */
export function useActivityHeartbeat(enabled: boolean = true) {
  const { data: session } = useSession();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPageVisibleRef = useRef(true);

  useEffect(() => {
    if (!enabled || !session?.user || session.user.type !== "regular") {
      return;
    }

    const memberId = getBackendMemberId(session.user);
    if (!memberId) {
      return;
    }

    // 发送心跳的函数
    const sendHeartbeat = async () => {
      // 如果页面不可见，跳过心跳（节省资源）
      if (!isPageVisibleRef.current) {
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_URL}/api/user/activity?user_id=${encodeURIComponent(memberId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[ActivityHeartbeat] Failed to send heartbeat:", response.status);
          }
        }
      } catch (error) {
        // 静默处理错误，不影响用户体验
        if (process.env.NODE_ENV === "development") {
          console.warn("[ActivityHeartbeat] Error sending heartbeat:", error);
        }
      }
    };

    // 立即发送一次心跳
    sendHeartbeat();

    // 设置定时器，定期发送心跳
    intervalRef.current = setInterval(
      sendHeartbeat,
      SESSION_TIMEOUT_CONFIG.HEARTBEAT_INTERVAL
    );

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      isPageVisibleRef.current = document.visibilityState === "visible";
      // 页面变为可见时，立即发送一次心跳
      if (isPageVisibleRef.current) {
        sendHeartbeat();
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
  }, [enabled, session]);
}

