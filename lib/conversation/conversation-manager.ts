/**
 * 会话/对话管理器
 * 管理不同用户-智能体的对话状态，确保多智能体对话流程稳定
 */

import { generateSessionId } from "@/lib/session-utils";

export type ConversationStatus = "idle" | "streaming" | "switching";

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  lastMessageId?: string;
  lastActivity: Date;
  messageCount: number;
}

export interface ConversationState {
  chatId: string;
  currentSessionId: string;
  currentAgentId: string;
  sessions: Map<string, SessionInfo>;
  status: ConversationStatus;
}

/**
 * 会话管理器类
 * 负责管理对话状态、Agent 切换、流恢复控制
 */
export class ConversationManager {
  private states: Map<string, ConversationState> = new Map();

  /**
   * 获取或创建对话状态
   */
  private getOrCreateState(chatId: string, agentId: string): ConversationState {
    let state = this.states.get(chatId);
    
    if (!state) {
      const sessionId = generateSessionId("", agentId); // 临时生成，实际需要 userId
      state = {
        chatId,
        currentSessionId: sessionId,
        currentAgentId: agentId,
        sessions: new Map(),
        status: "idle",
      };
      this.states.set(chatId, state);
    }
    
    return state;
  }

  /**
   * 获取当前 sessionId（基于 chatId 和 agentId）
   * @param chatId 前端对话容器 ID
   * @param agentId 当前活跃的 agentId
   * @param userId 用户 ID（用于生成 sessionId）
   */
  getCurrentSessionId(chatId: string, agentId: string, userId: string): string {
    const state = this.getOrCreateState(chatId, agentId);
    
    // 如果 agent 已切换，需要生成新的 sessionId
    if (state.currentAgentId !== agentId) {
      return this.switchAgent(chatId, agentId, userId);
    }
    
    // 如果当前 sessionId 不存在，生成新的
    if (!state.sessions.has(state.currentSessionId)) {
      const sessionId = generateSessionId(userId, agentId);
      state.currentSessionId = sessionId;
      state.currentAgentId = agentId;
      state.sessions.set(sessionId, {
        sessionId,
        agentId,
        lastActivity: new Date(),
        messageCount: 0,
      });
    }
    
    return state.currentSessionId;
  }

  /**
   * 切换 agent
   * @param chatId 前端对话容器 ID
   * @param newAgentId 新的 agentId
   * @param userId 用户 ID
   * @returns 新的 sessionId
   */
  switchAgent(chatId: string, newAgentId: string, userId: string): string {
    const state = this.getOrCreateState(chatId, newAgentId);
    
    // 如果已经是当前 agent，直接返回
    if (state.currentAgentId === newAgentId && state.currentSessionId) {
      return state.currentSessionId;
    }
    
    // 标记为切换状态
    state.status = "switching";
    
    // 生成新的 sessionId
    const newSessionId = generateSessionId(userId, newAgentId);
    
    // 检查是否已存在该 agent 的 session
    const existingSession = Array.from(state.sessions.values()).find(
      (s) => s.agentId === newAgentId
    );
    
    if (existingSession) {
      // 复用已有的 session
      state.currentSessionId = existingSession.sessionId;
    } else {
      // 创建新的 session
      state.currentSessionId = newSessionId;
      state.sessions.set(newSessionId, {
        sessionId: newSessionId,
        agentId: newAgentId,
        lastActivity: new Date(),
        messageCount: 0,
      });
    }
    
    state.currentAgentId = newAgentId;
    state.status = "idle";
    
    return state.currentSessionId;
  }

  /**
   * 检查是否可以恢复流
   * @param chatId 前端对话容器 ID
   * @param sessionId 要恢复的 sessionId
   * @param currentAgentId 当前活跃的 agentId
   */
  canResumeStream(
    chatId: string,
    sessionId: string,
    currentAgentId: string
  ): boolean {
    const state = this.states.get(chatId);
    
    if (!state) {
      return false;
    }
    
    // 如果正在切换 agent，不允许恢复流
    if (state.status === "switching") {
      return false;
    }
    
    // 检查 sessionId 是否匹配当前活跃的 session
    if (state.currentSessionId !== sessionId) {
      return false;
    }
    
    // 检查 agentId 是否匹配
    if (state.currentAgentId !== currentAgentId) {
      return false;
    }
    
    return true;
  }

  /**
   * 更新对话状态
   */
  updateStatus(chatId: string, status: ConversationStatus): void {
    const state = this.states.get(chatId);
    if (state) {
      state.status = status;
    }
  }

  /**
   * 更新 session 信息
   */
  updateSession(
    chatId: string,
    sessionId: string,
    updates: Partial<SessionInfo>
  ): void {
    const state = this.states.get(chatId);
    if (state) {
      const session = state.sessions.get(sessionId);
      if (session) {
        Object.assign(session, updates);
        session.lastActivity = new Date();
      }
    }
  }

  /**
   * 获取对话状态
   */
  getState(chatId: string): ConversationState | undefined {
    return this.states.get(chatId);
  }

  /**
   * 清除对话状态（用于测试或清理）
   */
  clearState(chatId: string): void {
    this.states.delete(chatId);
  }
}

// 单例实例
export const conversationManager = new ConversationManager();
