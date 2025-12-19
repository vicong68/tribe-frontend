/**
 * 统一的消息渲染工具函数
 * 用于统一管理所有对话类型（user_agent, user_user, agent_agent）的渲染逻辑
 * 确保思考状态（ThinkingMessage）与流式消息的渲染信息保持一致
 */

import type { ChatMessage } from "@/lib/types";
import type { Session } from "next-auth";
import type { ChatModel } from "./ai/models";
import { isAgentMessage, isRemoteUserMessage } from "./avatar-utils";
import { EntityFinder, EntityId, EntityResolver } from "./entity-utils";
import { getBackendMemberId } from "./user-utils";

// 记录每条消息首轮解析得到的 agent 渲染信息，避免后续因前端状态变化（如切换收信方）
// 导致已存在消息的名称/头像被重新兜底为新的 selectedModelId。
const agentRenderCache = new Map<
  string,
  {
    agentId?: string;
    senderName?: string;
    receiverName?: string; // ✅ 新增：缓存接收者名称（确保刷新后仍显示名称而不是ID）
  }
>();

/**
 * 从 chatModels 中查找 Agent 或用户的显示名称（向后兼容）
 * @deprecated 使用 EntityFinder.findDisplayName 代替
 */
type ModelLookup = Record<string, { name?: string }>;

function findDisplayName(
  chatModels: ChatModel[],
  id: string | undefined,
  type: "agent" | "user",
  fallback: string | undefined,
  modelLookup?: ModelLookup
): string {
  // 优先使用 modelLookup（向后兼容）
  if (id && modelLookup?.[id]?.name) {
    return modelLookup[id].name;
  }
  
  // 使用统一的 EntityFinder
  return EntityFinder.findDisplayName(chatModels, id, type, fallback);
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
    // ✅ 关键修复：分享消息必须使用当前登录用户的信息，确保头像生成一致
    const isSharedMessage = Boolean((meta as any)?.isSharedMessage);
    
    // 本地用户：优先使用当前 session 中的用户昵称，其次使用 metadata 中已固化的名称（大小写敏感）
    if (session?.user?.type === "guest") {
      senderName = meta.senderName || "访客";
    } else {
      // 优先级：session.user.name（当前用户昵称，大小写敏感） > meta.senderName（消息创建时固化的名称，大小写敏感）
      senderName = session?.user?.name || meta.senderName || "我";
    }
    
    // ✅ 关键修复：分享消息必须使用当前登录用户的信息，确保与本地用户默认消息的头像生成一致
    // 使用 getBackendMemberId 确保与 message-actions.tsx 中的逻辑完全一致
    if (isSharedMessage) {
      // 分享消息：强制使用当前登录用户的 memberId（使用 getBackendMemberId 确保格式一致）
      // 与 message-actions.tsx 中创建分享消息时使用的 currentUserId 保持一致
      senderId = (session?.user ? getBackendMemberId(session.user) : null) || meta.senderId || undefined;
    } else {
      // 普通本地用户消息：使用 metadata 中的 senderId 或 session 的 memberId
      senderId = meta.senderId || (session?.user ? getBackendMemberId(session.user) : null) || undefined;
    }
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
      ? EntityFinder.findDisplayName(chatModels, agentId, "agent", agentId || "智能体")
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
      ? EntityFinder.findDisplayName(chatModels, senderId, "user", senderId) ||
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
      ? EntityFinder.findDisplayName(chatModels, agentId, "agent", agentId || "智能体")
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
  // ✅ 最佳实践：后端已确保metadata中的receiverName是显示名称，前端主要完成渲染
  // 保留容错逻辑：如果metadata中的名称是ID，则从chatModels查找真实名称
  let receiverName: string | undefined;
  if (isLocalUser) {
    const isSharedMessage = Boolean((meta as any)?.isSharedMessage);
    const receiverId = meta.receiverId as string | undefined;
    
    // ✅ 优化：使用缓存机制，确保刷新后仍显示名称而不是ID
    const cached = agentRenderCache.get(message.id);
    
    // 优先使用缓存中的 receiverName（如果存在且有效）
    if (cached?.receiverName) {
      receiverName = cached.receiverName;
    } else {
      // ✅ 最佳实践：优先使用metadata中的receiverName（后端已确保是显示名称）
      receiverName = meta.receiverName;
      
      // ✅ 容错：检查metadata中的名称是否是ID（向后兼容旧数据）
      // 如果名称看起来像ID，则从chatModels查找真实名称
      if (receiverName && receiverId) {
        const isNameAnId = 
          receiverName.includes("@") || 
          receiverName === receiverId ||
          receiverName === EntityId.extractMemberId(receiverId) ||
          receiverName === EntityId.normalizeUserId(receiverId) ||
          receiverName.startsWith("user::");
        
        if (isNameAnId) {
          // 从 chatModels 查找用户/Agent 显示名称
          const entityType: "user" | "agent" = EntityId.isUserId(receiverId) ? "user" : "agent";
          const fallback = entityType === "user" 
            ? (EntityId.extractMemberId(receiverId) || receiverId)
            : receiverId;
          receiverName = EntityFinder.findDisplayName(chatModels, receiverId, entityType, fallback);
          
          // ✅ 关键修复：如果从 chatModels 查找失败（返回了ID或fallback），
          // 说明 chatModels 中没有该用户信息，需要从后端API获取
          // 但这里不能直接调用API（在渲染函数中），所以先使用fallback，后续通过useUsers加载
          // 如果 receiverName 仍然是ID格式，说明需要等待用户列表加载完成
          if (receiverName === fallback || receiverName === receiverId || receiverName.includes("@")) {
            // 暂时保留，等待用户列表加载后重新渲染
            // 注意：这里不设置为undefined，避免显示为空
          }
        }
      }
      
      // 如果仍然没有名称，使用 EntityResolver 作为后备
      if (!receiverName && receiverId) {
        const receiverInfo = EntityResolver.resolveReceiver(chatModels, meta, selectedModelId);
        if (receiverInfo) {
          receiverName = receiverInfo.name;
          // 再次检查是否是ID
          if (receiverName && (receiverName.includes("@") || receiverName === receiverId)) {
            const entityType: "user" | "agent" = EntityId.isUserId(receiverId) ? "user" : "agent";
            const fallback = entityType === "user" 
              ? (EntityId.extractMemberId(receiverId) || receiverId)
              : receiverId;
            receiverName = EntityFinder.findDisplayName(chatModels, receiverId, entityType, fallback);
          }
        }
      }
      
      // ✅ 根本原因修复：如果 receiverName 是"用户"（说明是历史数据中的占位符），
      // 不在这里回退，而是由刷新后恢复机制处理（chat.tsx 中的 useEffect）
      // 如果 receiverName 仍然是ID格式，说明需要等待用户列表加载，暂时保留ID
      // 注意：不再在这里设置"用户"作为后备，避免覆盖刷新后恢复机制
      
      // ✅ 缓存 receiverName（确保刷新后仍显示名称而不是ID）
      if (receiverName) {
        if (!cached) {
          agentRenderCache.set(message.id, {
            receiverName,
          });
        } else {
          // 更新现有缓存
          agentRenderCache.set(message.id, {
            ...cached,
            receiverName,
          });
        }
      }
    }
  }
  
  // 获取头像种子值（用于生成稳定的头像）
  // 统一使用缓存机制：优先使用已缓存的ID，避免受selectedModelId变化影响
  // ✅ 关键修复：确保远端用户的 avatarSeed 使用 user::member_id 格式，与好友列表和下拉列表保持一致
  const cached = agentRenderCache.get(message.id);
  let avatarSeed: string;
  if (isAgent) {
    // Agent 消息：优先使用缓存的agentId，确保稳定
    avatarSeed = cached?.agentId || agentId || senderId || "default";
  } else if (isRemoteUser) {
    // ✅ 远端用户消息：确保使用 user::member_id 格式，与好友列表和下拉列表保持一致
    // 好友列表和下拉列表使用 model.id（格式：user::member_id）
    // 这里也需要使用相同的格式，确保头像生成一致
    const rawSenderId = cached?.agentId || senderId;
    if (rawSenderId) {
      // 如果 senderId 存在，标准化为 user::member_id 格式
      // 注意：senderId 应该是 member_id（如 vicong@qq.com），不是显示名称
      avatarSeed = EntityId.normalizeUserId(rawSenderId) || rawSenderId;
    } else {
      // 如果 senderId 不存在，使用 senderName 作为后备（不添加 user:: 前缀，因为可能是显示名称）
      avatarSeed = senderName || "default";
    }
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
  const senderName = EntityFinder.findDisplayName(chatModels, agentId, "agent", agentId || "智能体");
  
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

