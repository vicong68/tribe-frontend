"use client";

import { useCallback, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  conversationManager,
  type ConversationStatus,
} from "@/lib/conversation/conversation-manager";
import { generateSessionId } from "@/lib/session-utils";

/**
 * 会话管理器 Hook
 * 提供对话状态管理、Agent 切换、流恢复控制等功能
 */
export function useConversationManager(chatId: string) {
  const { data: session } = useSession();
  const previousAgentIdRef = useRef<string | null>(null);

  // 获取用户 ID（用于生成 sessionId）
  const getUserId = useCallback((): string => {
    if (!session?.user) {
      return "guest_user";
    }
    
    // 优先使用 memberId，否则从 email 提取
    if (session.user.memberId) {
      return session.user.memberId;
    }
    
    if (session.user.email) {
      return session.user.email.split("@")[0];
    }
    
    return session.user.id;
  }, [session]);

  /**
   * 获取当前 sessionId
   */
  const getCurrentSessionId = useCallback(
    (agentId: string): string => {
      const userId = getUserId();
      return conversationManager.getCurrentSessionId(chatId, agentId, userId);
    },
    [chatId, getUserId]
  );

  /**
   * 切换 agent
   */
  const switchAgent = useCallback(
    (newAgentId: string): string => {
      const userId = getUserId();
      return conversationManager.switchAgent(chatId, newAgentId, userId);
    },
    [chatId, getUserId]
  );

  /**
   * 检查是否可以恢复流
   */
  const canResumeStream = useCallback(
    (sessionId: string, currentAgentId: string): boolean => {
      return conversationManager.canResumeStream(
        chatId,
        sessionId,
        currentAgentId
      );
    },
    [chatId]
  );

  /**
   * 更新对话状态
   */
  const updateStatus = useCallback(
    (status: ConversationStatus): void => {
      conversationManager.updateStatus(chatId, status);
    },
    [chatId]
  );

  /**
   * 检测 agent 切换
   */
  const detectAgentSwitch = useCallback(
    (currentAgentId: string): boolean => {
      const previousAgentId = previousAgentIdRef.current;
      const isSwitching = previousAgentId !== null && previousAgentId !== currentAgentId;
      
      if (isSwitching) {
        // 更新状态为切换中
        conversationManager.updateStatus(chatId, "switching");
        // 切换 agent
        switchAgent(currentAgentId);
      }
      
      previousAgentIdRef.current = currentAgentId;
      return isSwitching;
    },
    [chatId, switchAgent]
  );

  // 清理：组件卸载时重置状态
  useEffect(() => {
    return () => {
      previousAgentIdRef.current = null;
    };
  }, []);

  return {
    getCurrentSessionId,
    switchAgent,
    canResumeStream,
    updateStatus,
    detectAgentSwitch,
    getUserId,
  };
}

