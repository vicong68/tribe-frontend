"use client";

import { useChat, type UseChatOptions } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useState, useCallback, useRef, useEffect } from "react";
import { useNetworkStatus } from "./use-network-status";
import type { ChatMessage } from "@/lib/types";

/**
 * 扩展的 UseChatOptions，包含可选的 onError 和 onFinish 回调
 * 
 * 注意：AI SDK 的 onFinish 回调可能接收不同的参数类型
 * 为了兼容性，我们使用更灵活的类型定义
 */
type ExtendedUseChatOptions<T extends UIMessage = ChatMessage> = Omit<UseChatOptions<T>, 'onFinish' | 'onError'> & {
  id?: string;
  onError?: (error: Error) => void;
  onFinish?: () => void | Promise<void>;
} & {
  messages?: T[];
  generateId?: () => string;
};

/**
 * 带重试机制的流式聊天 Hook
 * 
 * 功能：
 * 1. 自动重试失败的请求（指数退避）
 * 2. 网络状态检测
 * 3. 错误处理和恢复
 */
export function useStreamChatWithRetry<T extends ChatMessage = ChatMessage>(
  options: ExtendedUseChatOptions<T>
) {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const lastMessageRef = useRef<T | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isOnline = useNetworkStatus();

  const maxRetries = 3;
  const baseRetryDelay = 1000;
  
  const chat = useChat<T>({
    ...options,
    // 确保 messages 参数被正确传递
    messages: options.messages || [],
    onError: (error) => {
      // 检查错误类型，只对网络错误和服务器错误（5xx）进行重试
      // 不重试客户端错误（4xx），如 bad_request, unauthorized, forbidden 等
      const errorMessage = error?.message || "";
      const isRetryableError =
        errorMessage.includes("network") ||
        errorMessage.includes("fetch") ||
        errorMessage.includes("offline") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("500") ||
        errorMessage.includes("502") ||
        errorMessage.includes("503") ||
        errorMessage.includes("504");

      // 如果是可重试的错误且未达到最大重试次数，尝试重试
      if (
        isRetryableError &&
        isOnline &&
        retryCount < maxRetries &&
        lastMessageRef.current &&
        !isRetrying
      ) {
        const delay = baseRetryDelay * Math.pow(2, retryCount);

        setIsRetrying(true);
        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount((prev) => prev + 1);
          // 重试发送最后一条消息
          if (lastMessageRef.current) {
            chat.sendMessage(lastMessageRef.current);
          }
        }, delay);
      } else {
        if (options.onError) {
          options.onError(error);
        }
        setIsRetrying(false);
        setRetryCount(0);
      }
    },
    onFinish: () => {
      // 成功完成，重置重试计数
      setRetryCount(0);
      setIsRetrying(false);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // 调用用户提供的 onFinish 回调（不传递参数，因为类型可能不匹配）
      if (options.onFinish) {
        options.onFinish();
      }
    },
  });
  
  // 保存最后一条消息，用于重试
  useEffect(() => {
    if (chat.messages.length > 0) {
      const lastMessage = chat.messages[chat.messages.length - 1];
      if (lastMessage.role === "user") {
        lastMessageRef.current = lastMessage as T;
      }
    }
  }, [chat.messages]);

  // 清理重试定时器
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOnline && isRetrying) {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      setIsRetrying(false);
    }
  }, [isOnline, isRetrying]);

  return {
    ...chat,
    isRetrying,
    retryCount,
  };
}

