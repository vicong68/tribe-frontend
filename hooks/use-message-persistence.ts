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

  /**
   * 保存 assistant 消息到数据库
   * 符合 AI SDK 的 onFinish 回调模式
   */
  const saveAssistantMessages = async (messagesToSave: ChatMessage[]) => {
    // 防止并发保存
    if (isSavingRef.current) {
      console.debug("[MessagePersistence] Save already in progress, skipping");
      return;
    }

    // 过滤出未保存的 assistant 消息
    const unsavedMessages = messagesToSave.filter(
      (msg) => msg.role === "assistant" && !savedMessageIdsRef.current.has(msg.id)
    );

    if (unsavedMessages.length === 0) {
      return;
    }

    // 标记为正在保存
    isSavingRef.current = true;

    // 记录要保存的消息 ID
    unsavedMessages.forEach((msg) => {
      savedMessageIdsRef.current.add(msg.id);
    });

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId,
          messages: unsavedMessages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MessagePersistence] Failed to save messages:", errorText);
        
        // 保存失败，从已保存集合中移除，允许重试
        unsavedMessages.forEach((msg) => {
          savedMessageIdsRef.current.delete(msg.id);
        });
        
        throw new Error(`Failed to save messages: ${errorText}`);
      }

      const result = await response.json();
      if (result.success) {
        const savedCount = result.saved || 0;
        console.log(`[MessagePersistence] ✅ Saved ${savedCount} assistant message(s) to database`);
        
        if (onSaveComplete) {
          onSaveComplete(savedCount);
        }
      }
    } catch (error) {
      console.error("[MessagePersistence] Error saving messages:", error);
      
      // 保存失败，从已保存集合中移除，允许重试
      unsavedMessages.forEach((msg) => {
        savedMessageIdsRef.current.delete(msg.id);
      });
    } finally {
      isSavingRef.current = false;
    }
  };

  /**
   * 在页面加载时检查并保存未保存的消息
   * 用于恢复场景（如页面刷新后）
   */
  useEffect(() => {
    if (!messages || messages.length === 0) {
      return;
    }

    const checkAndSaveMessages = async () => {
      // 延迟执行，确保页面和消息状态已完全加载
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      // 只保存 assistant 消息
      const assistantMessages = messages.filter((msg) => msg.role === "assistant");
      if (assistantMessages.length > 0) {
        await saveAssistantMessages(assistantMessages);
      }
    };

    // 在组件挂载且消息加载后执行
    checkAndSaveMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, messages.length]); // 当 chatId 或消息数量变化时执行

  return {
    saveAssistantMessages,
    savedMessageIds: savedMessageIdsRef.current,
  };
}

