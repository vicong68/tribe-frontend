/**
 * 统一的消息渲染工具函数
 * 用于统一管理所有对话类型（user_agent, user_user, agent_agent）的渲染逻辑
 * 确保思考状态（ThinkingMessage）与流式消息的渲染信息保持一致
 */

import type { ChatMessage } from "@/lib/types";
import type { Session } from "next-auth";
import type { ChatModel } from "./ai/models";
import { isAgentMessage, isRemoteUserMessage } from "./avatar-utils";

// 记录每条消息首轮解析得到的 agent 渲染信息，避免后续因前端状态变化（如切换收信方）
// 导致已存在消息的名称/头像被重新兜底为新的 selectedModelId。
const agentRenderCache = new Map<
  string,
  {
    agentId?: string;
    senderName?: string;
  }
>();

/**
 * 从 chatModels 中查找 Agent 或用户的显示名称
 */
type ModelLookup = Record<string, { name?: string }>;

function findDisplayName(
  chatModels: ChatModel[],
  id: string | undefined,
  type: "agent" | "user",
  fallback: string | undefined,
  modelLookup?: ModelLookup
): string {
  if (!id) {
    return fallback || "未知";
  }
  
  const fromLookup = modelLookup?.[id]?.name;
  if (fromLookup) {
    return fromLookup;
  }
  
  if (chatModels.length === 0) {
    return fallback || id || "未知";
  }
  
  const found = chatModels.find((m) => m.type === type && m.id === id);
  return found?.name || fallback || id;
}

/**
 * 对话类型枚举
 */
export type CommunicationType = "user_agent" | "user_user" | "agent_agent";

/**
 * 消息类型枚举
 */
export type MessageType = "local_user" | "agent" | "remote_user";

/**
 * 消息渲染信息
 */
export interface MessageRenderInfo {
  /** 消息类型 */
  messageType: MessageType;
  /** 对话类型 */
  communicationType?: CommunicationType;
  /** 发送者显示名称 */
  senderName: string;
  /** 发送者ID（用于头像生成） */
  senderId?: string;
  /** Agent ID（仅Agent消息） */
  agentId?: string;
  /** 接收者显示名称（仅用户消息） */
  receiverName?: string;
  /** 头像种子值（用于生成稳定的头像） */
  avatarSeed: string;
  /** 是否为Agent */
  isAgent: boolean;
  /** 是否为远端用户 */
  isRemoteUser: boolean;
  /** 是否为本地用户 */
  isLocalUser: boolean;
}

/**
 * 获取消息渲染信息的统一函数
 * 
 * @param message 消息对象
 * @param metadata 消息元数据（可选，如果 message.metadata 存在则优先使用）
 * @param selectedModelId 当前选择的模型ID（用于兜底）
 * @param session 用户会话（用于获取本地用户信息）
 * @param chatModels 聊天模型列表（用于查找显示名称）
 * @returns 消息渲染信息
 */
export function getMessageRenderInfo(
  message: ChatMessage,
  metadata: Record<string, any> | null | undefined,
  selectedModelId: string | undefined,
  session: Session | null,
  chatModels: ChatModel[],
  modelLookup?: ModelLookup
): MessageRenderInfo {
  // 使用传入的 metadata 或 message.metadata
  const meta = metadata || message.metadata || {};
  
  // 判断消息类型
  const isLocalUser = message.role === "user";
  const communicationType = meta.communicationType as CommunicationType | undefined;
  const isAssistantFallbackAgent =
    message.role === "assistant" &&
    !communicationType &&
    !!selectedModelId &&
    !selectedModelId.startsWith("user::");
  const isAgent = isAgentMessage(message.role, communicationType) || isAssistantFallbackAgent;
  const isRemoteUser = isRemoteUserMessage(message.role, communicationType);
  
  // 确定消息类型
  let messageType: MessageType;
  if (isLocalUser) {
    messageType = "local_user";
  } else if (isAgent) {
    messageType = "agent";
  } else if (isRemoteUser) {
    messageType = "remote_user";
  } else {
    // 默认：assistant 消息但无法确定类型，假设是 agent
    messageType = "agent";
  }
  
  // 获取发送者名称和ID
  let senderName: string;
  let senderId: string | undefined;
  let agentId: string | undefined;
  
  if (isLocalUser) {
    // 本地用户：优先使用 metadata，其次从 session 获取
    if (session?.user?.type === "guest") {
      senderName = meta.senderName || "访客";
    } else {
      senderName = meta.senderName || session?.user?.email?.split("@")[0] || "我";
    }
    senderId = meta.senderId || session?.user?.memberId || session?.user?.email?.split("@")[0];
  } else if (isAgent) {
    // Agent 消息：优先使用后端固化的 agentUsed/senderName
    // 统一缓存机制：首次解析时写入缓存，后续直接使用缓存，不受selectedModelId变化影响
    const cached = agentRenderCache.get(message.id);
    
    // 确定agentId：优先使用缓存，其次metadata，最后才用selectedModelId（仅首次解析时）
    const resolvedAgentId = cached?.agentId ||
      meta.agentUsed ||
      meta.senderId ||
      meta.receiverId ||
      (meta as any).agentId ||
      (cached ? undefined : selectedModelId); // 有缓存时不使用selectedModelId
    
    agentId = resolvedAgentId;
    senderId = agentId;
    
    // 确定名称：优先metadata，其次缓存，最后查表
    const nameFromModels = agentId 
      ? findDisplayName(chatModels, agentId, "agent", agentId || "智能体", modelLookup)
      : "智能体";
    let resolvedSenderName =
      meta.senderName ||
      cached?.senderName ||
      nameFromModels;
    
    // 首次解析时写入缓存，或当模型表提供更友好名称时更新缓存
    if (!cached) {
      // 首次解析：立即写入缓存，固化agentId和名称
      if (agentId) {
        agentRenderCache.set(message.id, {
          agentId,
          senderName: resolvedSenderName,
        });
      }
    } else if (
      cached.senderName === cached.agentId &&
      resolvedSenderName !== cached.senderName
    ) {
      // 缓存里是占位（与agentId相同），而模型表已提供更友好的名称，更新缓存
      agentRenderCache.set(message.id, {
        agentId: cached.agentId,
        senderName: resolvedSenderName,
      });
    }
    
    senderName = resolvedSenderName;
  } else if (isRemoteUser) {
    // 远端用户消息：使用相同的缓存机制，避免切换时名称漂移
    const cached = agentRenderCache.get(message.id);
    const resolvedSenderId = cached?.agentId || // 复用缓存字段存储senderId
      meta.senderId ||
      (cached ? undefined : selectedModelId); // 有缓存时不使用selectedModelId
    
    senderId = resolvedSenderId;
    
    // 确定名称：优先metadata，其次缓存，最后查表
    const nameFromModels = senderId
      ? findDisplayName(chatModels, senderId, "user", senderId, modelLookup) ||
        (chatModels.find((m) => m.type === "user" && m.name === meta.senderName)?.name) ||
        "用户"
      : "用户";
    
    senderName = meta.senderName ||
      cached?.senderName ||
      nameFromModels;
    
    // 首次解析时写入缓存
    if (!cached && senderId) {
      agentRenderCache.set(message.id, {
        agentId: senderId, // 复用字段
        senderName,
      });
    }
  } else {
    // 其他情况（可能是 metadata 为空时的 assistant 消息，假设是 agent）
    // 使用相同的缓存机制
    const cached = agentRenderCache.get(message.id);
    const resolvedAgentId = cached?.agentId ||
      meta.agentUsed ||
      meta.senderId ||
      (cached ? undefined : selectedModelId); // 有缓存时不使用selectedModelId
    
    agentId = resolvedAgentId;
    senderId = agentId;
    
    const nameFromModels = agentId
      ? findDisplayName(chatModels, agentId, "agent", agentId || "智能体", modelLookup)
      : "智能体";
    senderName = meta.senderName ||
      cached?.senderName ||
      nameFromModels;
    
    // 首次解析时写入缓存
    if (!cached && agentId) {
      agentRenderCache.set(message.id, {
        agentId,
        senderName,
      });
    }
  }
  
  // 获取接收者名称（仅用户消息）
  let receiverName: string | undefined;
  if (isLocalUser) {
    receiverName = meta.receiverName;
    const isSharedMessage = Boolean((meta as any)?.isSharedMessage);
    
    // 用户-用户直发：补齐收件人名称
    if (communicationType === "user_user" && !receiverName) {
      const receiverId = meta.receiverId as string | undefined;
      receiverName = receiverId?.replace(/^user::/, "");
    }
    
    // 用户-Agent 消息：从 chatModels 查找 Agent 显示名称
    if (!receiverName && !isSharedMessage && selectedModelId && !selectedModelId.startsWith("user::")) {
      receiverName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId, modelLookup);
    }
  }
  
  // 获取头像种子值（用于生成稳定的头像）
  // 统一使用缓存机制：优先使用已缓存的ID，避免受selectedModelId变化影响
  const cached = agentRenderCache.get(message.id);
  let avatarSeed: string;
  if (isAgent) {
    // Agent 消息：优先使用缓存的agentId，确保稳定
    avatarSeed = cached?.agentId || agentId || senderId || "default";
  } else if (isRemoteUser) {
    // 远端用户消息：优先使用缓存的senderId
    avatarSeed = cached?.agentId || senderId || senderName || "default";
  } else {
    // 本地用户消息：使用 senderId 或 senderName
    avatarSeed = senderId || senderName || "default";
  }
  
  return {
    messageType,
    communicationType,
    senderName,
    senderId,
    agentId,
    receiverName,
    avatarSeed,
    isAgent,
    isRemoteUser,
    isLocalUser,
  };
}

/**
 * 获取思考消息的渲染信息（用于 ThinkingMessage 组件）
 * 
 * @param selectedModelId 当前选择的模型ID
 * @param chatModels 聊天模型列表（用于查找显示名称）
 * @returns 思考消息渲染信息
 */
export function getThinkingMessageRenderInfo(
  selectedModelId: string | undefined,
  chatModels: ChatModel[],
  modelLookup?: ModelLookup
): Pick<MessageRenderInfo, "senderName" | "avatarSeed" | "agentId"> {
  // 从 chatModels 查找 Agent 显示名称
  const agentId = selectedModelId;
  const senderName = findDisplayName(chatModels, agentId, "agent", agentId || "智能体", modelLookup);
  
  // 头像种子值：使用 agent_id，确保与流式回复消息一致
  const avatarSeed = agentId || senderName;
  
  return {
    senderName,
    avatarSeed,
    agentId,
  };
}

/**
 * 对话类型渲染步骤总结
 * 
 * 1. user_agent（用户-Agent对话）
 *    - 用户消息：显示本地用户信息，接收方为 Agent
 *    - Agent 消息：显示 Agent 信息（思考状态 + 流式回复）
 *    - 思考状态：使用 selectedModelId 查找 Agent 显示名称和头像
 *    - 流式回复：使用 metadata.agentUsed 和 metadata.senderName（后端传递）
 * 
 * 2. user_user（用户-用户对话）
 *    - 用户消息：显示本地用户信息，接收方为远端用户
 *    - 远端用户消息：显示远端用户信息
 *    - 无思考状态（用户-用户消息不需要思考）
 * 
 * 3. agent_agent（Agent-Agent对话，未来扩展）
 *    - Agent 消息：显示 Agent 信息
 *    - 思考状态：使用 selectedModelId 查找 Agent 显示名称和头像
 *    - 流式回复：使用 metadata.agentUsed 和 metadata.senderName
 */

