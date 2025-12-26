"use client";

import { createContext, useContext, ReactNode } from "react";
import { useSSEMessages, type SSEMessage, type FileProgressMessage } from "@/hooks/use-sse-messages";
import { useSession } from "next-auth/react";

/**
 * SSE 消息上下文
 */
interface SSEMessageContextValue {
  messages: SSEMessage[];
  fileProgress: FileProgressMessage[];
  status: "connecting" | "connected" | "disconnected" | "error";
  isConnected: boolean;
  reconnect: () => void;
  reconnectAttempts: number;
  onMessage: (handler: (message: SSEMessage) => void) => () => void;
  onFileProgress: (handler: (progress: FileProgressMessage) => void) => () => void;
}

const SSEMessageContext = createContext<SSEMessageContextValue | null>(null);

/**
 * SSE 消息提供者组件
 * 
 * 功能：
 * 1. 管理全局 SSE 连接
 * 2. 提供消息接收功能（用户-用户消息、文件进度等）
 * 3. 处理连接状态和重连
 */
export function SSEMessageProvider({ children }: { children: ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  
  // ✅ 使用统一的用户ID获取函数，确保格式正确（memberId > email > id）
  // 只在 session 完全加载后才提取用户ID，避免无效连接
  const userId = sessionStatus === "authenticated" && session?.user
    ? (() => {
        // 优先使用 memberId（后端用户ID，完整邮箱格式）
        if (session.user.memberId) {
          return session.user.memberId;
        }
        // 如果没有 memberId，使用完整的 email（后端 member_id 是完整邮箱格式）
        if (session.user.email) {
          return session.user.email;
        }
        // 最后使用 id
        return session.user.id || null;
      })()
    : null;

  const {
    messages,
    fileProgress,
    status,
    isConnected,
    reconnect,
    reconnectAttempts,
    onMessage,
    onFileProgress,
  } = useSSEMessages(userId);

  return (
    <SSEMessageContext.Provider
      value={{
        messages,
        fileProgress,
        status,
        isConnected,
        reconnect,
        reconnectAttempts,
        onMessage,
        onFileProgress,
      }}
    >
      {children}
    </SSEMessageContext.Provider>
  );
}

/**
 * 使用 SSE 消息 Hook
 */
export function useSSEMessageContext() {
  const context = useContext(SSEMessageContext);
  if (!context) {
    throw new Error(
      "useSSEMessageContext must be used within SSEMessageProvider"
    );
  }
  return context;
}

// 向后兼容的别名
export const WebSocketMessageProvider = SSEMessageProvider;
export const useWebSocketMessageContext = useSSEMessageContext;

