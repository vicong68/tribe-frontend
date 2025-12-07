"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { SESSION_TIMEOUT_CONFIG } from "@/lib/config/session-timeout";

/**
 * 用户活动监听 Hook
 * 监听用户的各种活动事件，记录最后活动时间
 */
export function useActivityMonitor() {
  // 使用惰性初始化函数，确保只在客户端执行
  const [lastActivityTime, setLastActivityTime] = useState<number>(() => {
    // 在客户端才计算时间，避免 SSR 不一致
    if (typeof window !== "undefined") {
      return Date.now();
    }
    return 0;
  });
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 更新活动时间的防抖函数
  const updateActivityTime = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setLastActivityTime(Date.now());
    }, SESSION_TIMEOUT_CONFIG.ACTIVITY_DEBOUNCE);
  }, []);

  useEffect(() => {
    // 监听用户活动事件
    const events = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
      "focus",
    ];

    // 添加事件监听器
    events.forEach((event) => {
      window.addEventListener(event, updateActivityTime, { passive: true });
    });

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // 页面变为可见时，更新活动时间
        updateActivityTime();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 清理函数
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, updateActivityTime);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [updateActivityTime]);

  // 使用 useMemo 计算 isActive，避免在 SSR 时计算
  const isActive = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return Date.now() - lastActivityTime < SESSION_TIMEOUT_CONFIG.INACTIVITY_TIMEOUT;
  }, [lastActivityTime]);

  return {
    lastActivityTime,
    isActive,
  };
}

