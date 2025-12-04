"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * WebSocket 消息类型
 */
export interface WebSocketMessage {
  message_type: "message" | "message_file" | "file";
  content: string;
  sender_id: string;
  sender_name: string;
  receiver_id: string;
  receiver_name: string;
  session_id: string;
  file_attachment?: any;
  message_id?: string;
  timestamp?: number;
  created_at?: string;
}

/**
 * WebSocket 连接状态
 */
type WebSocketStatus = "connecting" | "connected" | "disconnected" | "error";

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
 * WebSocket 消息管理 Hook
 * 
 * 功能：
 * 1. 管理 WebSocket 连接
 * 2. 接收和发送消息
 * 3. 自动重连机制
 * 4. 心跳检测
 * 5. 网络状态检测
 */
export function useWebSocketMessages(userId: string | null) {
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messageHandlersRef = useRef<Set<(message: WebSocketMessage) => void>>(new Set());
  
  const isOnline = useOnlineStatus();
  
  // 重连配置
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1秒
  const pingInterval = 30000; // 30秒

  /**
   * 获取 WebSocket URL
   */
  const getWebSocketUrl = useCallback(() => {
    // 在客户端，使用 window.location 或环境变量
    // 在服务器端，使用环境变量
    let backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
    
    // 如果是客户端环境，尝试从 window 获取（如果有配置）
    if (typeof window !== "undefined") {
      // 可以在这里添加客户端特定的逻辑
      // 例如：从 localStorage 或全局配置读取
    }
    
    // 将 http:// 或 https:// 替换为 ws:// 或 wss://
    const wsUrl = backendUrl.replace(/^http/, "ws") + `/api/ws/messages/${userId}`;
    
    // 调试日志
    if (typeof window !== "undefined") {
      console.log("[WS] 构建 WebSocket URL:", {
        backendUrl,
        userId,
        wsUrl,
        envVar: process.env.NEXT_PUBLIC_BACKEND_URL,
      });
    }
    
    return wsUrl;
  }, [userId]);

  /**
   * 清理资源
   */
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  /**
   * 建立 WebSocket 连接
   */
  const connect = useCallback(() => {
    if (!userId) {
      console.log("[WS] ⚠️ 用户ID为空，跳过连接");
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("[WS] ✅ WebSocket 已连接，跳过重复连接");
      return;
    }

    if (!isOnline) {
      console.log("[WS] ⚠️ 网络离线，跳过连接");
      setStatus("disconnected");
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      
      // 验证 URL 格式
      if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
        console.error("[WS] ❌ 无效的 WebSocket URL:", wsUrl);
        setStatus("error");
        return;
      }
      
      console.log("[WS] 🔌 正在连接 WebSocket:", wsUrl);
      console.log("[WS] 👤 UserId:", userId);
      setStatus("connecting");

      // 创建 WebSocket 连接
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // 添加连接超时检测
      let connectionTimeout: NodeJS.Timeout | null = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.error("[WS] ❌ 连接超时（5秒），关闭连接");
          console.error("[WS] 💡 诊断提示：");
          console.error("  1. 检查后端服务是否在运行: curl http://localhost:3000/health");
          console.error("  2. 检查后端 URL 是否正确:", wsUrl);
          console.error("  3. 检查后端 WebSocket 路由是否注册: /api/ws/messages/{user_id}");
          console.error("  4. 检查防火墙或网络设置");
          ws.close();
          setStatus("error");
          connectionTimeout = null;
        }
      }, 5000);

      ws.onopen = () => {
        console.log("[WS] ✅ WebSocket 连接已建立");
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        setStatus("connected");
        setReconnectAttempts(0);

        // 启动心跳机制
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "ping",
                timestamp: Date.now(),
              })
            );
          } else {
            // 连接已关闭，清理心跳
            if (pingIntervalRef.current) {
              clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = null;
            }
          }
        }, pingInterval);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // 处理心跳响应
          if (data.type === "pong") {
            // 心跳响应，忽略
            return;
          }

          // 处理错误消息
          if (data.type === "error") {
            console.error("[WS] 收到错误消息:", data.message);
            return;
          }

          // 处理消息确认
          if (data.type === "message_sent_confirmation") {
            console.log("[WS] 消息发送确认:", data.message_id);
            return;
          }

          // 处理用户-用户消息
          if (data.message_type) {
            const message: WebSocketMessage = {
              message_type: data.message_type,
              content: data.content,
              sender_id: data.sender_id,
              sender_name: data.sender_name,
              receiver_id: data.receiver_id,
              receiver_name: data.receiver_name,
              session_id: data.session_id,
              file_attachment: data.file_attachment,
              message_id: data.message_id,
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
                console.error("[WS] 消息处理器错误:", error);
              }
            });
          }
        } catch (error) {
          console.error("[WS] 解析消息失败:", error, event.data);
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] WebSocket 错误:", error);
        console.error("[WS] WebSocket URL:", wsUrl);
        console.error("[WS] UserId:", userId);
        console.error("[WS] WebSocket readyState:", ws.readyState);
        console.error("[WS] WebSocket protocol:", ws.protocol);
        console.error("[WS] WebSocket extensions:", ws.extensions);
        
        // 根据 readyState 提供更详细的错误信息
        if (ws.readyState === WebSocket.CLOSED) {
          console.error("[WS] 连接已关闭，可能的原因：");
          console.error("  1. 后端服务未运行");
          console.error("  2. WebSocket 路由不存在");
          console.error("  3. CORS 配置问题");
          console.error("  4. 网络连接问题");
        } else if (ws.readyState === WebSocket.CONNECTING) {
          console.error("[WS] 连接中，但发生错误");
        }
        
        setStatus("error");
      };

      ws.onclose = (event) => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        console.log(
          "[WS] WebSocket 连接已关闭:",
          `code=${event.code}`,
          `reason=${event.reason || "无原因"}`,
          `wasClean=${event.wasClean}`
        );
        
        // 根据关闭代码提供更详细的错误信息
        if (event.code === 1006) {
          console.error("[WS] ❌ 异常关闭 (1006)，可能的原因：");
          console.error("  1. 后端服务未运行或无法访问");
          console.error("  2. WebSocket 路由路径不正确");
          console.error("  3. 网络连接问题");
          console.error("  4. 后端 WebSocket 路由未正确注册");
        } else if (event.code === 1008) {
          console.error("[WS] ❌ 策略违规 (1008)，可能的原因：");
          console.error("  1. CORS 配置问题");
          console.error("  2. Origin 未授权");
        } else if (event.code === 1000) {
          console.log("[WS] ✅ 正常关闭 (1000)");
        } else if (event.code === 1001) {
          console.log("[WS] 端点离开 (1001)");
        } else if (event.code === 1002) {
          console.error("[WS] ❌ 协议错误 (1002)");
        } else if (event.code === 1003) {
          console.error("[WS] ❌ 数据类型错误 (1003)");
        }
        
        setStatus("disconnected");

        // 清理心跳
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // 自动重连（如果网络在线且未达到最大重连次数）
        if (isOnline && reconnectAttempts < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
          console.log(
            `[WS] ${delay}ms 后尝试重连 (第 ${reconnectAttempts + 1}/${maxReconnectAttempts} 次)`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts((prev) => prev + 1);
            connect();
          }, delay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.error("[WS] 达到最大重连次数，停止重连");
        }
      };
    } catch (error) {
      console.error("[WS] 建立连接失败:", error);
      setStatus("error");
    }
  }, [userId, isOnline, getWebSocketUrl, reconnectAttempts]);

  /**
   * 手动重连
   */
  const reconnect = useCallback(() => {
    console.log("[WS] 手动重连");
    cleanup();
    setReconnectAttempts(0);
    setStatus("disconnected");
    connect();
  }, [cleanup, connect]);

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    (payload: {
      type: "send_message";
      receiver_id: string;
      content: string;
      session_id: string;
      file_attachment?: any;
    }): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error("[WS] WebSocket 未连接，无法发送消息");
        return false;
      }

        try {
        ws.send(JSON.stringify(payload));
          return true;
        } catch (error) {
          console.error("[WS] 发送消息失败:", error);
        return false;
      }
    },
    []
  );

  /**
   * 注册消息处理器
   */
  const onMessage = useCallback((handler: (message: WebSocketMessage) => void) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  // 连接和断开连接
  useEffect(() => {
    if (userId) {
      connect();
    }

    return () => {
      cleanup();
    };
  }, [userId, connect, cleanup]);

  // 网络状态变化时重连
  useEffect(() => {
    if (isOnline && status === "disconnected" && userId) {
      console.log("[WS] 网络恢复，尝试重连");
      reconnect();
    }
  }, [isOnline, status, userId, reconnect]);

  return {
    messages,
    status,
    isConnected: status === "connected",
    sendMessage,
    reconnect,
    reconnectAttempts,
    onMessage,
  };
}
