"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * SSE 消息类型
 */
export interface SSEMessage {
  message_type: "message" | "message_file" | "file" | "file_progress" | "heartbeat";
  content: string;
  sender_id: string;
  sender_name: string;
  receiver_id: string;
  receiver_name: string;
  communication_type: "user_agent" | "user_user" | "agent_agent" | "file_progress" | "heartbeat";
  file_attachment?: any;
  session_id?: string;
  timestamp?: number;
  created_at?: string;
}

/**
 * 文件进度消息
 */
export interface FileProgressMessage {
  file_id: string;
  progress: number;
  message: string;
  stage?: string;
}

/**
 * SSE 连接状态
 */
type SSEStatus = "connecting" | "connected" | "disconnected" | "error";

/**
 * 网络状态检测 Hook
 */
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof window !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * SSE 消息管理 Hook
 * 
 * 功能：
 * 1. 管理 SSE 连接
 * 2. 接收消息（用户-用户消息、文件进度等）
 * 3. 自动重连机制
 * 4. 网络状态检测
 */
export function useSSEMessages(userId: string | null) {
  const [messages, setMessages] = useState<SSEMessage[]>([]);
  const [fileProgress, setFileProgress] = useState<Map<string, FileProgressMessage>>(new Map());
  const [status, setStatus] = useState<SSEStatus>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageHandlersRef = useRef<Set<(message: SSEMessage) => void>>(new Set());
  const fileProgressHandlersRef = useRef<Set<(progress: FileProgressMessage) => void>>(new Set());
  
  const isOnline = useOnlineStatus();
  
  // 重连配置
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1秒

  /**
   * 获取 SSE URL
   * 使用相对路径，通过 Next.js API 路由代理，避免跨域问题
   */
  const getSSEUrl = useCallback(() => {
    // 使用相对路径，通过 Next.js API 路由代理到后端
    const sseUrl = `/api/sse/events/${userId}?heartbeat_interval=30`;
    // 移除构建 URL 的日志（减少日志噪音）
    return sseUrl;
  }, [userId]);

  /**
   * 清理资源
   */
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  /**
   * 建立 SSE 连接
   */
  const connect = useCallback(() => {
    if (!userId) {
      // 用户ID为空时不输出日志，避免控制台噪音
      return;
    }

    // 验证用户ID格式（应该不是空字符串或无效值）
    if (userId.trim() === "" || userId === "null" || userId === "undefined") {
      console.warn("[SSE] ⚠️ 用户ID格式无效，跳过连接:", userId);
      return;
    }

    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      // 已连接时不输出日志
      return;
    }

    if (!isOnline) {
      setStatus("disconnected");
      return;
    }

    try {
      const sseUrl = getSSEUrl();
      // 仅在首次连接或重连时输出日志（减少日志噪音）
      if (process.env.NODE_ENV === "development" && reconnectAttempts === 0) {
        console.log("[SSE] 🔌 正在连接 SSE:", sseUrl);
      }
      setStatus("connecting");

      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        // 仅在开发环境输出连接成功日志
        if (process.env.NODE_ENV === "development") {
          console.log("[SSE] ✅ SSE 连接已建立");
        }
        setStatus("connected");
        setReconnectAttempts(0);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // 处理心跳
          if (data.message_type === "heartbeat" || data.communication_type === "heartbeat") {
            return;
          }

          // 处理文件进度
          if (data.message_type === "file_progress" || data.communication_type === "file_progress") {
            try {
              const progressData = JSON.parse(data.content) as FileProgressMessage;
              setFileProgress((prev) => {
                const newMap = new Map(prev);
                newMap.set(progressData.file_id, progressData);
                return newMap;
              });

              // 触发文件进度处理器
              fileProgressHandlersRef.current.forEach((handler) => {
                try {
                  handler(progressData);
                } catch (error) {
                  console.error("[SSE] 文件进度处理器错误:", error);
                }
              });
            } catch (error) {
              console.error("[SSE] 解析文件进度失败:", error, data.content);
            }
            return;
          }

          // 处理用户-用户消息
          if (data.communication_type === "user_user" && data.message_type) {
            const message: SSEMessage = {
              message_type: data.message_type,
              content: data.content,
              sender_id: data.sender_id,
              sender_name: data.sender_name,
              receiver_id: data.receiver_id,
              receiver_name: data.receiver_name,
              communication_type: data.communication_type,
              file_attachment: data.file_attachment,
              session_id: data.session_id,
              timestamp: data.timestamp,
              created_at: data.created_at,
            };

            // 添加到消息列表
            setMessages((prev) => [...prev, message]);

            // 触发消息处理器
            messageHandlersRef.current.forEach((handler) => {
              try {
                handler(message);
              } catch (error) {
                console.error("[SSE] 消息处理器错误:", error);
              }
            });
          }
        } catch (error) {
          console.error("[SSE] 解析消息失败:", error, event.data);
        }
      };

      eventSource.onerror = (error) => {
        // 只在开发环境或连接状态为 CLOSED 时输出错误日志
        if (eventSource.readyState === EventSource.CLOSED) {
          // 只在开发环境或首次连接失败时输出详细错误
          if (process.env.NODE_ENV === "development" || reconnectAttempts === 0) {
            console.warn("[SSE] 连接已关闭，可能的原因：");
            console.warn("  1. 后端服务未运行或未启动 SSE 路由");
            console.warn("  2. 用户ID无效或后端无法识别");
            console.warn("  3. 网络连接问题");
          }
          setStatus("error");
          
          // 自动重连（指数退避）
          if (isOnline && reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
            
            // 只在开发环境输出重连日志
            if (process.env.NODE_ENV === "development") {
              console.log(
                `[SSE] ${delay}ms 后尝试重连 (第 ${reconnectAttempts + 1}/${maxReconnectAttempts} 次)`
              );
            }

            reconnectTimeoutRef.current = setTimeout(() => {
              setReconnectAttempts((prev) => prev + 1);
              connect();
            }, delay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            // 达到最大重连次数，静默失败（不输出错误日志，避免控制台噪音）
            setStatus("disconnected");
          }
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          setStatus("connecting");
        }
      };
    } catch (error) {
      console.error("[SSE] 建立连接失败:", error);
      setStatus("error");
    }
  }, [userId, isOnline, getSSEUrl, reconnectAttempts]);

  /**
   * 手动重连
   */
  const reconnect = useCallback(() => {
    // 仅在开发环境输出手动重连日志
    if (process.env.NODE_ENV === "development") {
      console.log("[SSE] 手动重连");
    }
    cleanup();
    setReconnectAttempts(0);
    setStatus("disconnected");
    connect();
  }, [cleanup, connect]);

  /**
   * 注册消息处理器
   */
  const onMessage = useCallback((handler: (message: SSEMessage) => void) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  /**
   * 注册文件进度处理器
   */
  const onFileProgress = useCallback((handler: (progress: FileProgressMessage) => void) => {
    fileProgressHandlersRef.current.add(handler);
    return () => {
      fileProgressHandlersRef.current.delete(handler);
    };
  }, []);

  // 连接和断开连接
  // 添加延迟以确保会话完全初始化后再建立连接
  useEffect(() => {
    if (!userId) {
      return;
    }

    // 如果已经连接，跳过（防止 Fast Refresh 时重复连接）
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    // 延迟建立连接，等待会话和页面完全初始化
    const connectTimer = setTimeout(() => {
      connect();
    }, 500); // 延迟 500ms

    return () => {
      clearTimeout(connectTimer);
      cleanup();
    };
  }, [userId, connect, cleanup]);

  // 网络状态变化时重连
  useEffect(() => {
    if (isOnline && status === "disconnected" && userId) {
      // 仅在开发环境输出重连日志
      if (process.env.NODE_ENV === "development") {
        console.log("[SSE] 网络恢复，尝试重连");
      }
      reconnect();
    }
  }, [isOnline, status, userId, reconnect]);

  return {
    messages,
    fileProgress: Array.from(fileProgress.values()),
    status,
    isConnected: status === "connected",
    reconnect,
    reconnectAttempts,
    onMessage,
    onFileProgress,
  };
}

