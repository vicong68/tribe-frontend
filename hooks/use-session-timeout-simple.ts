"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { getBackendMemberId, updateBackendOnlineStatus } from "@/lib/user-utils";
import { toast } from "@/components/toast";

/**
 * 增强的会话超时管理 Hook
 * ✅ 优化：支持多种不活跃场景判断（关闭浏览器、页面、网络中断等）
 * 
 * 逻辑：
 * 1. 监听用户活动事件，记录最后活动时间
 * 2. 监听页面卸载、网络状态变化等事件，及时更新后端状态
 * 3. 定期检查（每1分钟），如果超过40分钟无活动，自动注销
 * 4. 只在页面可见时检查，节省资源
 */
const INACTIVITY_TIMEOUT = 40 * 60 * 1000; // ✅ 改为40分钟
const CHECK_INTERVAL = 60 * 1000; // 1分钟检查一次
const ACTIVITY_DEBOUNCE = 1000; // 活动检测防抖1秒

export function useSessionTimeoutSimple(enabled: boolean = true) {
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  
  // 最后活动时间（使用惰性初始化，避免SSR问题）
  const [lastActivityTime, setLastActivityTime] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const now = Date.now();
      return now;
    }
    return 0;
  });
  
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPageVisibleRef = useRef(true);
  // 使用 ref 存储最新的活动时间，避免 setInterval 闭包问题
  const lastActivityTimeRef = useRef<number>(0);

  // 更新活动时间的防抖函数
  const updateActivityTime = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const now = Date.now();
      lastActivityTimeRef.current = now;
      setLastActivityTime(now);
    }, ACTIVITY_DEBOUNCE);
  }, []);

  useEffect(() => {
    if (!enabled || !isLoggedIn) {
      return;
    }

    const memberId = getBackendMemberId(session?.user);
    if (!memberId) {
      return;
    }

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

    // ✅ 优化：监听页面可见性变化（包括切换标签页、最小化窗口等）
    const handleVisibilityChange = () => {
      isPageVisibleRef.current = document.visibilityState === "visible";
      if (isPageVisibleRef.current) {
        // 页面变为可见时，更新活动时间
        updateActivityTime();
      } else {
        // 页面变为不可见时，也更新活动时间（用户可能切换到其他应用）
        // 但标记为不可见状态，用于后续判断
        updateActivityTime();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // ✅ 新增：监听网络状态变化（网络中断/恢复）
    const handleOnline = () => {
      updateActivityTime();
    };

    const handleOffline = () => {
      // 网络中断时，也更新活动时间（但标记为离线状态）
      updateActivityTime();
      // 可选：通知后端用户可能离线（但不断开连接，等待网络恢复）
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // ✅ 新增：监听页面卸载（关闭浏览器、刷新页面等）
    const handleBeforeUnload = () => {
      // 使用 sendBeacon 确保状态更新能发送到后端
      updateBackendOnlineStatus(memberId, false).catch(() => {
        // 如果 fetch 失败，使用 sendBeacon 作为后备
        import("@/lib/user-utils").then(({ updateBackendOfflineStatusWithBeacon }) => {
          updateBackendOfflineStatusWithBeacon(memberId);
        });
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // 初始化 ref
    lastActivityTimeRef.current = lastActivityTime;

    // 检查会话是否过期的函数
    const checkSessionExpiry = () => {
      // 只在页面可见时检查
      if (!isPageVisibleRef.current) {
        return;
      }

      // 使用 ref 获取最新的活动时间，避免 setInterval 闭包问题
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityTimeRef.current;

      if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
        // ✅ 超过40分钟无活动，执行自动注销
        // 清理定时器
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current);
        }

        // 显示提示信息
        toast({
          type: "info",
          description: "由于长时间未活动（40分钟），您已被自动注销",
        });

        // 更新后端状态
        updateBackendOnlineStatus(memberId, false).catch(() => {
          // 错误已在函数内部处理
        });

        // 执行注销
        signOut({
          redirectTo: "/",
        });
      }
    };

    // 设置定时器，定期检查会话是否过期
    checkIntervalRef.current = setInterval(checkSessionExpiry, CHECK_INTERVAL);

    // 清理函数
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, updateActivityTime);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [enabled, isLoggedIn, session, updateActivityTime]);

  // 同步 lastActivityTime 到 ref
  useEffect(() => {
    lastActivityTimeRef.current = lastActivityTime;
  }, [lastActivityTime]);
}

