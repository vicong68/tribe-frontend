/**
 * 统一的消息渲染工具函数
 * 用于统一管理所有对话类型（user_agent, user_user, agent_agent）的渲染逻辑
 * 确保思考状态（ThinkingMessage）与流式消息的渲染信息保持一致
 */

import type { ChatMessage } from "@/lib/types";
import type { Session } from "next-auth";
import type { ChatModel } from "@/lib/ai/models-client";
import { isAgentMessage, isRemoteUserMessage } from "./avatar-utils";

/**
 * 从 chatModels 中查找 Agent 或用户的显示名称
 */
function findDisplayName(
  chatModels: ChatModel[],
  id: string | undefined,
  type: "agent" | "user",
  fallback?: string
): string {
  if (!id || chatModels.length === 0) {
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
 * @param isStreaming 是否正在流式传输中（用于优化渲染逻辑）
 * @returns 消息渲染信息
 */
export function getMessageRenderInfo(
  message: ChatMessage,
  metadata: Record<string, any> | null | undefined,
  selectedModelId: string | undefined,
  session: Session | null,
  chatModels: ChatModel[],
  isStreaming: boolean = false
): MessageRenderInfo {
  // 使用传入的 metadata 或 message.metadata
  const meta = metadata || message.metadata || {};
  
  // 判断消息类型
  const isLocalUser = message.role === "user";
  const communicationType = meta.communicationType as CommunicationType | undefined;
  const isAgent = isAgentMessage(message.role, communicationType) ||
    (message.role === "assistant" && !communicationType && selectedModelId && !selectedModelId.startsWith("user::"));
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
    // ✅ 标准化 Agent 消息渲染流程：
    // 1. 流式传输中：优先使用 selectedModelId（确保及时显示切换后的 agent）
    // 2. 流式传输完成：使用 metadata（后端已固化保存的显示名称，与入库信息一致）
    // 3. 历史消息：完全依赖 metadata（从数据库加载的完整信息），不使用 selectedModelId
    const metadataAgentId = meta.agentUsed || meta.senderId;
    
    // 流式传输中：优先使用 selectedModelId，确保切换 agent 后立即显示正确的名称和头像
    if (isStreaming && selectedModelId) {
      agentId = selectedModelId;
      senderId = agentId;
      // 如果 metadata 已更新且与 selectedModelId 一致，使用 metadata.senderName（更准确）
      // 否则使用 selectedModelId 查找显示名称（确保及时显示）
      if (metadataAgentId === selectedModelId && meta.senderName) {
        senderName = meta.senderName;
      } else {
        senderName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId || "智能体");
      }
    } else {
      // ✅ 修复：非流式传输（已完成或历史消息）：完全依赖 metadata，不使用 selectedModelId
      // 历史消息应该显示发送时的 agent，而不是当前选择的 agent
      if (metadataAgentId) {
        // 有 metadata.agentUsed：使用 metadata（历史消息或已完成的消息）
        agentId = metadataAgentId;
        senderId = agentId;
        
        if (meta.senderName) {
          // 有 metadata.senderName：使用 metadata.senderName（与入库信息一致）
          senderName = meta.senderName;
        } else {
          // 兜底：从 chatModels 查找显示名称（使用 metadataAgentId，不是 selectedModelId）
          senderName = findDisplayName(chatModels, metadataAgentId, "agent", metadataAgentId || "智能体");
        }
      } else {
        // ✅ 特殊情况：metadata 为空（可能是旧数据或异常情况），使用 selectedModelId 作为兜底
        // 但这种情况应该很少见，因为后端应该总是保存 metadata
        agentId = selectedModelId;
        senderId = agentId;
        senderName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId || "智能体");
      }
    }
  } else if (isRemoteUser) {
    // 远端用户消息：优先使用 metadata.senderName
    senderId = meta.senderId;
    
    if (meta.senderName) {
      senderName = meta.senderName;
    } else if (senderId) {
      // 尝试通过 senderId 查找，如果找不到则尝试通过 name 查找
      senderName = findDisplayName(chatModels, senderId, "user") ||
        (chatModels.find((m) => m.type === "user" && m.name === meta.senderName)?.name) ||
        "用户";
    } else {
      senderName = "用户";
    }
  } else {
    // ✅ 修复：其他情况（可能是 metadata 为空时的 assistant 消息，假设是 agent）
    // 对于非流式传输，优先使用 metadata，不使用 selectedModelId
    const metadataAgentId = meta.agentUsed || meta.senderId;
    
    if (metadataAgentId) {
      // 有 metadata：使用 metadata（历史消息或已完成的消息）
      agentId = metadataAgentId;
      senderId = agentId;
      
      if (meta.senderName) {
        senderName = meta.senderName;
      } else {
        senderName = findDisplayName(chatModels, metadataAgentId, "agent", metadataAgentId || "智能体");
      }
    } else {
      // ✅ 特殊情况：metadata 为空（可能是旧数据或异常情况），使用 selectedModelId 作为兜底
      // 但这种情况应该很少见，因为后端应该总是保存 metadata
      agentId = selectedModelId;
      senderId = agentId;
      senderName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId || "智能体");
    }
  }
  
  // 获取接收者名称（仅用户消息）
  let receiverName: string | undefined;
  if (isLocalUser) {
    receiverName = meta.receiverName;
    
    // 用户-用户直发：补齐收件人名称
    if (communicationType === "user_user" && !receiverName) {
      const receiverId = meta.receiverId as string | undefined;
      receiverName = receiverId?.replace(/^user::/, "");
    }
    
    // 用户-Agent 消息：从 chatModels 查找 Agent 显示名称
    if (!receiverName && !meta.isSharedMessage && selectedModelId && !selectedModelId.startsWith("user::")) {
      receiverName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId);
    }
  }
  
  // 获取头像种子值（用于生成稳定的头像）
  let avatarSeed: string;
  if (isAgent) {
    // Agent 消息：优先使用 agent_id，确保与思考消息一致
    avatarSeed = agentId || senderId || selectedModelId || "default";
  } else if (isRemoteUser) {
    // 远端用户消息：使用 senderId
    avatarSeed = senderId || senderName || "default";
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
  chatModels: ChatModel[]
): Pick<MessageRenderInfo, "senderName" | "avatarSeed" | "agentId"> {
  // 从 chatModels 查找 Agent 显示名称
  const agentId = selectedModelId;
  const senderName = findDisplayName(chatModels, selectedModelId, "agent", selectedModelId || "智能体");
  
  // 头像种子值：使用 agent_id，确保与流式回复消息一致
  const avatarSeed = selectedModelId || senderName;
  
  return {
    senderName,
    avatarSeed,
    agentId,
  };
}

/**
 * 标准化用户-Agent对话渲染流程
 * 
 * 1. 用户切换agent后，输入消息并发送
 * 2. 右侧渲染用户消息（使用本地用户信息）
 * 3. 左侧渲染 ThinkingMessage（使用 selectedModelId 查找 Agent 显示名称和头像）
 * 4. 流式回复到达：
 *    - 流式传输中：优先使用 selectedModelId（确保及时显示切换后的 agent）
 *    - metadata 更新后：使用 metadata.senderName（与入库信息一致）
 * 5. 流式传输完成：使用 metadata（后端已固化保存的显示名称，与入库信息一致）
 * 6. 历史消息：完全依赖 metadata（从数据库加载的完整信息），不使用 selectedModelId
 *    - 关键修复：历史消息应该显示发送时的 agent，而不是当前选择的 agent
 *    - 如果 metadata 为空（旧数据），才使用 selectedModelId 作为兜底
 * 
 * 对话类型渲染步骤总结：
 * 
 * 1. user_agent（用户-Agent对话）
 *    - 用户消息：显示本地用户信息，接收方为 Agent
 *    - Agent 消息：显示 Agent 信息（思考状态 + 流式回复）
 *    - 思考状态：使用 selectedModelId 查找 Agent 显示名称和头像
 *    - 流式回复：优先使用 selectedModelId，metadata 更新后使用 metadata.senderName
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

