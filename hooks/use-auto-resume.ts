"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect } from "react";
import { useDataStream } from "@/components/data-stream-provider";
import type { ChatMessage } from "@/lib/types";
export type UseAutoResumeParams = {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  chatId: string;
  currentAgentId: string;
  conversationManager: {
    getCurrentSessionId: (agentId: string) => string;
    canResumeStream: (chatId: string, sessionId: string, currentAgentId: string) => boolean;
  };
};

export function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages,
  chatId,
  currentAgentId,
  conversationManager,
}: UseAutoResumeParams) {
  const { dataStream } = useDataStream();

  useEffect(() => {
    if (!autoResume) {
      return;
    }

    const mostRecentMessage = initialMessages.at(-1);

    // 只有当最后一条消息是用户消息时才尝试恢复流
    // 这表示有未完成的对话需要恢复
    if (mostRecentMessage?.role === "user") {
      // 获取当前 sessionId
      const currentSessionId = conversationManager.getCurrentSessionId(currentAgentId);
      
      // 检查是否可以恢复流（确保 sessionId 和 agentId 匹配）
      const canResume = conversationManager.canResumeStream(
        chatId,
        currentSessionId,
        currentAgentId
      );
      
      if (!canResume) {
        // 如果无法恢复流（例如正在切换 agent），静默跳过
        if (process.env.NODE_ENV === "development") {
          console.debug("[use-auto-resume] Cannot resume stream (agent switching or session mismatch)");
        }
        return;
      }
      
      // 使用 try-catch 捕获流恢复错误，避免在切换 agent 时显示错误
      resumeStream().catch((error) => {
        // 静默处理流恢复错误（可能是切换 agent 时没有流可恢复）
        // 只在开发环境记录日志
        if (process.env.NODE_ENV === "development") {
          console.debug("[use-auto-resume] Stream resume failed (expected when switching agents):", error);
        }
      });
    }

    // we intentionally run this once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResume, initialMessages.at, resumeStream, chatId, currentAgentId, conversationManager]);

  useEffect(() => {
    if (!dataStream) {
      return;
    }
    if (dataStream.length === 0) {
      return;
    }

    const dataPart = dataStream[0];

    if (dataPart.type === "data-appendMessage") {
      const message = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message]);
    }
  }, [dataStream, initialMessages, setMessages]);
}
