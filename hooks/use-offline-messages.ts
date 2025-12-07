"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

/**
 * 离线消息类型（与后端 API 响应格式匹配）
 */
interface OfflineMessageItem {
  session_id: string;
  sender_id: string;
  sender_nickname?: string;
  body: string;
  created_at?: string;
  file_attachment?: {
    file_id: string;
    download_url: string;
    file_name: string;
    file_type: string;
  };
}

interface OfflineMessagesResponse {
  offline_messages: OfflineMessageItem[];
}

/**
 * 离线消息拉取 Hook
 * 
 * 功能：
 * 1. 在用户登录成功且 SSE 连接建立后，主动拉取离线消息
 * 2. 将离线消息转换为 ChatMessage 格式
 * 3. 通过回调函数通知调用者处理消息
 * 4. 拉取完离线消息后，触发用户列表和状态拉取
 * 
 * 注意：只有登录用户（非访客）才会拉取离线消息
 */
export function useOfflineMessages({
  userId,
  isLoggedIn,
  isConnected,
  onMessages,
  onOfflineMessagesFetched, // 新增：离线消息拉取完成后的回调
}: {
  userId: string | null;
  isLoggedIn: boolean; // 是否为登录用户（非访客）
  isConnected: boolean;
  onMessages: (messages: ChatMessage[]) => void;
  onOfflineMessagesFetched?: () => void; // 新增：离线消息拉取完成后的回调
}) {
  const fetchedRef = useRef(false);
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

  useEffect(() => {
    // 只在登录用户、连接建立后且未拉取过时执行
    // 访客状态不需要拉取离线消息
    if (!isLoggedIn || !isConnected || !userId || fetchedRef.current) {
      return;
    }

    // 标记为已拉取，避免重复拉取
    fetchedRef.current = true;

    // 异步拉取离线消息
    const fetchOfflineMessages = async () => {
      try {
        // 使用前端 API 路由代理，避免跨域问题
        const response = await fetch(
          `/api/sse/offline_messages?user_id=${encodeURIComponent(userId)}&timeout=5&wait_interval=1`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(10000), // 10秒超时
          }
        );

        if (!response.ok) {
          // 记录错误信息，便于调试
          if (process.env.NODE_ENV === "development") {
            const errorText = await response.text().catch(() => "");
            console.warn("[OfflineMessages] 拉取离线消息失败:", response.status, errorText);
          }
          // 即使失败也触发回调，确保用户列表能拉取
          if (onOfflineMessagesFetched) {
            onOfflineMessagesFetched();
          }
          return;
        }

        const data = (await response.json()) as OfflineMessagesResponse;
        const offlineMessages = data.offline_messages || [];

        // 离线消息拉取完成，无论是否有消息都触发回调
        // 这样即使没有离线消息，也能确保用户列表和状态拉取
        if (onOfflineMessagesFetched) {
          onOfflineMessagesFetched();
        }

        if (offlineMessages.length === 0) {
          // 没有离线消息，直接返回（功能已完成，可以关闭）
          return;
        }

        // 转换为 ChatMessage 格式
        const chatMessages: ChatMessage[] = offlineMessages.map((msg) => {
          const parts: any[] = [];

          // 添加文件附件（如果有）
          if (msg.file_attachment) {
            parts.push({
              type: "file" as const,
              url: msg.file_attachment.download_url || msg.file_attachment.file_id,
              name: msg.file_attachment.file_name || "file",
              mediaType: msg.file_attachment.file_type || "application/octet-stream",
            });
          }

          // 添加文本内容（如果有）
          if (msg.body && msg.body !== "[FILE_TRANSFER]") {
            parts.push({
              type: "text" as const,
              text: msg.body,
            });
          }

          return {
            id: generateUUID(),
            role: "assistant",
            parts,
            metadata: {
              createdAt: msg.created_at || new Date().toISOString(),
              senderId: msg.sender_id,
              senderName: msg.sender_nickname || msg.sender_id,
              receiverId: userId,
              communicationType: "user_user",
            },
          };
        });

        // 通知调用者处理消息
        onMessages(chatMessages);
        
        // 离线消息拉取完成（已在上面触发，这里确保触发）
        // 注意：离线消息拉取是一次性的，完成后功能可以关闭
        if (onOfflineMessagesFetched) {
          onOfflineMessagesFetched();
        }
      } catch (error) {
        // 静默处理错误，不影响用户体验
        if (process.env.NODE_ENV === "development") {
          console.warn("[OfflineMessages] 拉取离线消息异常:", error);
        }
        // 即使出错也触发回调，确保用户列表能拉取
        if (onOfflineMessagesFetched) {
          onOfflineMessagesFetched();
        }
      }
    };

    // 延迟拉取，确保 SSE 连接完全建立
    const timeoutId = setTimeout(fetchOfflineMessages, 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [userId, isLoggedIn, isConnected, onMessages]);

  // 当连接断开或用户登出时，重置拉取标记，以便重连或重新登录后再次拉取
  useEffect(() => {
    if (!isConnected || !isLoggedIn) {
      fetchedRef.current = false;
    }
  }, [isConnected, isLoggedIn]);
}

