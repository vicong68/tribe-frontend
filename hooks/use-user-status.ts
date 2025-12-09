"use client";

import { useCallback } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 用户在线状态更新回调
 */
export type UserStatusUpdateCallback = (updates: Map<string, boolean>) => void;

// 全局缓存，避免多个组件重复拉取
const globalStatusCache = new Map<string, boolean>();
let globalLastFetch = 0;
const FETCH_COOLDOWN = 1000; // 1秒冷却时间，避免频繁请求

/**
 * 用户状态管理 Hook
 * 
 * 功能：
 * 1. 快速查询用户在线状态（轻量级API）
 * 2. 监听SSE推送的用户状态更新
 * 3. 更新全局用户状态缓存
 */
export function useUserStatus({
  isLoggedIn,
  onStatusUpdate,
}: {
  isLoggedIn: boolean;
  onStatusUpdate: UserStatusUpdateCallback;
}) {
  /**
   * 快速查询用户在线状态（轻量级API，只返回状态）
   */
  const fetchUserStatus = useCallback(async (): Promise<Map<string, boolean>> => {
    if (!isLoggedIn) {
      return new Map();
    }

    const now = Date.now();
    if (now - globalLastFetch < FETCH_COOLDOWN) {
      return new Map(globalStatusCache);
    }
    globalLastFetch = now;

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/entity/users/status`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(3000), // 3秒超时，快速响应
        }
      );

      if (!response.ok) {
        return new Map(globalStatusCache);
      }

      const data = await response.json();
      globalStatusCache.clear();

      if (data.users && Array.isArray(data.users)) {
        for (const user of data.users) {
          if (user.member_id && typeof user.is_online === "boolean") {
            globalStatusCache.set(user.member_id, user.is_online);
            globalStatusCache.set(`user::${user.member_id}`, user.is_online);
          }
        }
      }

      return new Map(globalStatusCache);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[UserStatus] 查询用户状态失败:", error);
      }
      return new Map(globalStatusCache);
    }
  }, [isLoggedIn]);

  /**
   * 处理SSE推送的用户状态更新
   */
  const handleStatusUpdate = useCallback((updates: Map<string, boolean>) => {
    for (const [userId, isOnline] of updates.entries()) {
      globalStatusCache.set(userId, isOnline);
      if (!userId.startsWith("user::")) {
        globalStatusCache.set(`user::${userId}`, isOnline);
      } else {
        const memberId = userId.replace(/^user::/, "");
        globalStatusCache.set(memberId, isOnline);
      }
    }
    onStatusUpdate(updates);
  }, [onStatusUpdate]);

  return {
    fetchUserStatus,
    handleStatusUpdate,
    getCachedStatus: useCallback((userId: string): boolean | undefined => {
      return globalStatusCache.get(userId);
    }, []),
  };
}

