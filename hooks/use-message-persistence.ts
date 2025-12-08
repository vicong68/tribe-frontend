"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/types";

/**
 * 消息持久化 Hook
 * 符合 AI SDK 规范的消息保存机制
 * 
 * 参考: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot/message-persistence
 * 
 * 功能：
 * 1. 在流式响应完成后自动保存 assistant 消息
 * 2. 避免重复保存
 * 3. 错误处理和重试机制
 */
export function useMessagePersistence({
  chatId,
  messages,
  onSaveComplete,
}: {
  chatId: string;
  messages: ChatMessage[];
  onSaveComplete?: (savedCount: number) => void;
}) {
  const savedMessageIdsRef = useRef<Set<string>>(new Set());
  const isSavingRef = useRef(false);
  const pendingMessagesRef = useRef<ChatMessage[]>([]);
  const retryCountRef = useRef<Map<string, number>>(new Map());
  const maxRetries = 3;
  const retryDelay = 1000; // 1秒

  const hasValidContent = (msg: ChatMessage) =>
    msg.parts &&
    Array.isArray(msg.parts) &&
    msg.parts.length > 0 &&
    msg.parts.some((p: any) => {
      if (!p || typeof p !== "object") return false;
      if (p.type === "data-appendMessage") return false;
      if (p.type === "text" && p.text && p.text.trim().length > 0) return true;
      if (p.type === "file") return true;
      if (p.type !== "text" && p.type !== "file") return true;
      return false;
    });

  /**
   * 保存 assistant 消息到数据库（带重试机制）
   * 符合 AI SDK 的 onFinish 回调模式
   */
  const saveAssistantMessages = async (messagesToSave: ChatMessage[], retryAttempt = 0) => {
    // 过滤出未保存的 assistant 消息
    const unsavedMessages = messagesToSave.filter(
      (msg) => msg.role === "assistant" && !savedMessageIdsRef.current.has(msg.id)
    );

    const validMessages = unsavedMessages.filter(hasValidContent);
    const invalidMessages = unsavedMessages.filter((msg) => !hasValidContent(msg));
    if (invalidMessages.length > 0 && process.env.NODE_ENV === "development") {
      console.warn("[MessagePersistence] Skipping invalid messages (no valid content):", invalidMessages.map((m) => m.id));
    }

    if (validMessages.length === 0) {
      return;
    }

    // 防止并发保存（但允许重试）
    if (isSavingRef.current && retryAttempt === 0) {
      // 如果是首次尝试且正在保存，将消息加入待处理队列
      pendingMessagesRef.current.push(...validMessages);
      console.debug("[MessagePersistence] Save in progress, queuing messages:", validMessages.length);
      return;
    }

    // 标记为正在保存
    isSavingRef.current = true;

    // 记录要保存的消息 ID（仅在首次尝试时）
    if (retryAttempt === 0) {
      validMessages.forEach((msg) => {
      savedMessageIdsRef.current.add(msg.id);
        retryCountRef.current.set(msg.id, 0);
    });
    }

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId,
          messages: validMessages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MessagePersistence] Failed to save messages (attempt ${retryAttempt + 1}):`, errorText);
        
        // 如果是可重试的错误且未达到最大重试次数，进行重试
        if (retryAttempt < maxRetries && (
          response.status === 500 || 
          response.status === 502 || 
          response.status === 503 || 
          response.status === 504 ||
          response.status === 408
        )) {
          // 更新重试计数
          validMessages.forEach((msg) => {
            const currentRetry = retryCountRef.current.get(msg.id) || 0;
            retryCountRef.current.set(msg.id, currentRetry + 1);
          });
          
          // 延迟后重试
          setTimeout(() => {
            saveAssistantMessages(validMessages, retryAttempt + 1).catch((error) => {
              console.error("[MessagePersistence] Retry failed:", error);
            });
          }, retryDelay * (retryAttempt + 1)); // 指数退避
          
          isSavingRef.current = false;
          return;
        }
        
        // 达到最大重试次数或不可重试的错误，从已保存集合中移除
        validMessages.forEach((msg) => {
          savedMessageIdsRef.current.delete(msg.id);
          retryCountRef.current.delete(msg.id);
        });
        
        throw new Error(`Failed to save messages after ${retryAttempt + 1} attempts: ${errorText}`);
      }

      const result = await response.json();
      if (result.success) {
        const savedCount = result.saved || 0;
        const savedIds = new Set<string>(result.messageIds || []);
        if (process.env.NODE_ENV === "development") {
          console.log(`[MessagePersistence] Saved ${savedCount} assistant message(s)`, { savedIds: [...savedIds] });
        }
        
        // 清除重试计数
        validMessages.forEach((msg) => {
          retryCountRef.current.delete(msg.id);
        });
        
        if (savedCount === 0 && validMessages.length > 0 && process.env.NODE_ENV === "development") {
          console.warn("[MessagePersistence] ⚠️  No messages were saved, but we tried to save:", validMessages.length);
          console.warn("[MessagePersistence] Messages that were filtered:", validMessages.map(m => ({
            id: m.id,
            parts: m.parts
          })));
          // 允许后续重试
          validMessages.forEach((msg) => {
            savedMessageIdsRef.current.delete(msg.id);
          });
        } else if (savedIds.size > 0 && savedIds.size < validMessages.length) {
          // 后端部分保存成功时，移除未保存的 ID，允许重试
          validMessages.forEach((msg) => {
            if (!savedIds.has(msg.id)) {
              savedMessageIdsRef.current.delete(msg.id);
            }
          });
        }
        
        if (onSaveComplete) {
          onSaveComplete(savedCount);
        }
        
        // 处理待处理的消息
        if (pendingMessagesRef.current.length > 0) {
          const pending = [...pendingMessagesRef.current];
          pendingMessagesRef.current = [];
          setTimeout(() => {
            saveAssistantMessages(pending, 0).catch((error) => {
              console.error("[MessagePersistence] Failed to save pending messages:", error);
            });
          }, 100);
        }
      }
    } catch (error) {
      console.error("[MessagePersistence] Error saving messages:", error);
      
      // 如果是网络错误且未达到最大重试次数，进行重试
      if (retryAttempt < maxRetries && error instanceof TypeError) {
        validMessages.forEach((msg) => {
          const currentRetry = retryCountRef.current.get(msg.id) || 0;
          retryCountRef.current.set(msg.id, currentRetry + 1);
        });
        
        setTimeout(() => {
          saveAssistantMessages(validMessages, retryAttempt + 1).catch((error) => {
            console.error("[MessagePersistence] Retry failed:", error);
          });
        }, retryDelay * (retryAttempt + 1));
        
        isSavingRef.current = false;
        return;
      }
      
      // 达到最大重试次数，从已保存集合中移除
      validMessages.forEach((msg) => {
        savedMessageIdsRef.current.delete(msg.id);
        retryCountRef.current.delete(msg.id);
      });
    } finally {
      isSavingRef.current = false;
    }
  };

  /**
   * 在页面加载时检查并保存未保存的消息（用于恢复场景）
   */
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const checkAndSaveMessages = async () => {
      // 延迟执行，确保消息状态已完全加载
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      const assistantMessages = messages.filter((msg) => 
        msg.role === "assistant" &&
        msg.parts &&
        Array.isArray(msg.parts) &&
        msg.parts.length > 0 &&
        msg.parts.some((p: any) => 
          p && typeof p === 'object' &&
          ((p.type === "text" && p.text && p.text.trim().length > 0) ||
           p.type === "file" ||
           (p.type !== "text" && p.type !== "file" && p.type !== "data-appendMessage"))
        )
      );
      
      if (assistantMessages.length > 0) {
        if (process.env.NODE_ENV === "development") {
          console.log("[MessagePersistence] checkAndSaveMessages: Found", assistantMessages.length, "assistant messages to save");
        }
        await saveAssistantMessages(assistantMessages);
      }
    };

    checkAndSaveMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, messages.length]);

  return {
    saveAssistantMessages,
    savedMessageIds: savedMessageIdsRef.current,
  };
}

