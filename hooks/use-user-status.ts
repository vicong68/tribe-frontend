"use client";

import { useEffect, useRef, useCallback } from "react";
import type { ChatModel } from "@/lib/ai/models";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 用户在线状态更新回调
 */
export type UserStatusUpdateCallback = (updates: Map<string, boolean>) => void;

/**
 * 用户状态管理 Hook
 * 
 * 功能：
 * 1. 快速查询用户在线状态（轻量级API）
 * 2. 监听SSE推送的用户状态更新
 * 3. 更新本地用户状态缓存
 */
export function useUserStatus({
  isLoggedIn,
  onStatusUpdate,
}: {
  isLoggedIn: boolean;
  onStatusUpdate: UserStatusUpdateCallback;
}) {
  const statusCacheRef = useRef<Map<string, boolean>>(new Map());
  const lastFetchRef = useRef<number>(0);
  const FETCH_COOLDOWN = 1000; // 1秒冷却时间，避免频繁请求

  /**
   * 快速查询用户在线状态（轻量级API，只返回状态）
   */
  const fetchUserStatus = useCallback(async (): Promise<Map<string, boolean>> => {
    if (!isLoggedIn) {
      return new Map();
    }

    const now = Date.now();
    // 冷却时间检查
    if (now - lastFetchRef.current < FETCH_COOLDOWN) {
      return statusCacheRef.current;
    }
    lastFetchRef.current = now;

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
        return statusCacheRef.current;
      }

      const data = await response.json();
      const statusMap = new Map<string, boolean>();

      if (data.users && Array.isArray(data.users)) {
        for (const user of data.users) {
          if (user.member_id && typeof user.is_online === "boolean") {
            statusMap.set(user.member_id, user.is_online);
            statusMap.set(`user::${user.member_id}`, user.is_online); // 同时支持两种格式
          }
        }
      }

      // 更新缓存
      statusCacheRef.current = statusMap;
      return statusMap;
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[UserStatus] 查询用户状态失败:", error);
      }
      return statusCacheRef.current;
    }
  }, [isLoggedIn]);

  /**
   * 处理SSE推送的用户状态更新
   */
  const handleStatusUpdate = useCallback((updates: Map<string, boolean>) => {
    // 更新缓存
    for (const [userId, isOnline] of updates.entries()) {
      statusCacheRef.current.set(userId, isOnline);
      // 同时更新 user:: 格式
      if (!userId.startsWith("user::")) {
        statusCacheRef.current.set(`user::${userId}`, isOnline);
      } else {
        const memberId = userId.replace(/^user::/, "");
        statusCacheRef.current.set(memberId, isOnline);
      }
    }
    // 通知回调
    onStatusUpdate(updates);
  }, [onStatusUpdate]);

  return {
    fetchUserStatus,
    handleStatusUpdate,
    getCachedStatus: useCallback((userId: string): boolean | undefined => {
      return statusCacheRef.current.get(userId);
    }, []),
  };
}

