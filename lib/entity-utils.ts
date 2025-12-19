/**
 * 统一的实体信息管理工具
 * 整合智能体和用户的ID、名称获取逻辑，提供统一、精简、稳定的API
 */

import type { ChatModel } from "./ai/models";

/**
 * 实体类型
 */
export type EntityType = "agent" | "user";

/**
 * 实体ID格式标准化
 */
export class EntityId {
  /**
   * 标准化用户ID为 user::member_id 格式
   */
  static normalizeUserId(id: string | undefined | null): string | null {
    if (!id) return null;
    if (id.startsWith("user::")) return id;
    return `user::${id}`;
  }

  /**
   * 从标准化用户ID中提取 member_id
   */
  static extractMemberId(userId: string | undefined | null): string | null {
    if (!userId) return null;
    return userId.replace(/^user::/, "");
  }

  /**
   * 判断是否为用户ID
   */
  static isUserId(id: string | undefined | null): boolean {
    if (!id) return false;
    return id.startsWith("user::") || !id.includes("::");
  }

  /**
   * 判断是否为Agent ID
   */
  static isAgentId(id: string | undefined | null): boolean {
    if (!id) return false;
    return !id.startsWith("user::");
  }
}

/**
 * 实体信息查找器
 * 统一管理从 ChatModel[] 中查找实体信息的逻辑
 */
export class EntityFinder {
  /**
   * 从 chatModels 中查找实体的显示名称
   * @param chatModels 模型列表
   * @param id 实体ID（支持多种格式）
   * @param type 实体类型
   * @param fallback 后备名称
   * @returns 显示名称
   */
  static findDisplayName(
    chatModels: ChatModel[],
    id: string | undefined | null,
    type: EntityType,
    fallback?: string
  ): string {
    if (!id) {
      return fallback || (type === "user" ? "用户" : "智能体");
    }

    // 标准化ID格式
    const normalizedId = type === "user" 
      ? EntityId.normalizeUserId(id) 
      : id;

    if (!normalizedId) {
      return fallback || (type === "user" ? "用户" : "智能体");
    }

    // 从 chatModels 中查找
    const found = chatModels.find((m) => {
      if (m.type !== type) return false;
      if (type === "user") {
        // 用户：支持多种ID格式匹配
        const modelMemberId = EntityId.extractMemberId(m.id);
        const searchMemberId = EntityId.extractMemberId(normalizedId);
        return m.id === normalizedId || 
               modelMemberId === searchMemberId ||
               modelMemberId === id ||
               EntityId.extractMemberId(m.id) === id;
      } else {
        // Agent：精确匹配
        return m.id === normalizedId || m.id === id;
      }
    });

    return found?.name || fallback || id;
  }

  /**
   * 从 chatModels 中查找实体对象
   */
  static findEntity(
    chatModels: ChatModel[],
    id: string | undefined | null,
    type: EntityType
  ): ChatModel | undefined {
    if (!id) return undefined;

    const normalizedId = type === "user" 
      ? EntityId.normalizeUserId(id) 
      : id;

    if (!normalizedId) return undefined;

    return chatModels.find((m) => {
      if (m.type !== type) return false;
      if (type === "user") {
        const modelMemberId = EntityId.extractMemberId(m.id);
        const searchMemberId = EntityId.extractMemberId(normalizedId);
        return m.id === normalizedId || 
               modelMemberId === searchMemberId ||
               modelMemberId === id ||
               EntityId.extractMemberId(m.id) === id;
      } else {
        return m.id === normalizedId || m.id === id;
      }
    });
  }

  /**
   * 获取用户显示名称（智能处理：如果传入的是用户ID，自动转换为昵称）
   * 用于收藏消息等场景，确保显示昵称而不是ID
   * 
   * @deprecated 建议使用 findDisplayName 代替，更统一
   */
  static getUserDisplayName(
    chatModels: ChatModel[],
    senderName: string | null | undefined,
    messageRole: "user" | "assistant"
  ): string {
    if (!senderName) {
      return messageRole === "user" ? "用户" : "智能体";
    }

    // ✅ 统一使用 findDisplayName 方法
    if (messageRole === "user" && senderName.includes("@")) {
      // 如果 senderName 看起来像用户ID（包含@符号），尝试从 chatModels 中查找用户昵称
      return this.findDisplayName(chatModels, senderName, "user", senderName);
    }

    // 否则直接返回 senderName（可能是昵称或智能体名称）
    return senderName;
  }

  /**
   * 统一获取实体显示名称（推荐使用）
   * 自动判断实体类型，确保始终返回显示名称而不是ID
   * 
   * @param chatModels 模型列表
   * @param entityId 实体ID（支持多种格式）
   * @param fallback 后备名称（可选）
   * @returns 显示名称
   */
  static getEntityDisplayName(
    chatModels: ChatModel[],
    entityId: string | null | undefined,
    fallback?: string
  ): string {
    if (!entityId) {
      return fallback || "未知";
    }

    // 自动判断实体类型
    const entityType: EntityType = EntityId.isUserId(entityId) ? "user" : "agent";
    return this.findDisplayName(chatModels, entityId, entityType, fallback || entityId);
  }
}

/**
 * 实体信息解析器
 * 用于从消息元数据中解析实体信息
 */
export class EntityResolver {
  /**
   * 解析发送者信息
   */
  static resolveSender(
    chatModels: ChatModel[],
    metadata: Record<string, any> | null | undefined,
    messageRole: "user" | "assistant",
    session: { user?: { name?: string | null; memberId?: string | null; email?: string | null; type?: string } } | null
  ): {
    id: string | undefined;
    name: string;
    type: EntityType;
  } {
    if (messageRole === "user") {
      // 本地用户
      const senderId = metadata?.senderId || session?.user?.memberId || undefined;
      const senderName = session?.user?.name || 
                        metadata?.senderName || 
                        (session?.user?.type === "guest" ? "访客" : "我");
      return {
        id: senderId,
        name: senderName,
        type: "user",
      };
    } else {
      // Assistant（可能是Agent或远端用户）
      const agentId = metadata?.agentUsed || metadata?.senderId || metadata?.receiverId;
      const senderId = metadata?.senderId;
      
      // 判断是否为远端用户
      const communicationType = metadata?.communicationType;
      const isRemoteUser = communicationType === "user_user";

      if (isRemoteUser && senderId) {
        // 远端用户
        const name = metadata?.senderName || 
                     EntityFinder.findDisplayName(chatModels, senderId, "user", senderId);
        return {
          id: senderId,
          name,
          type: "user",
        };
      } else {
        // Agent
        const name = metadata?.senderName || 
                     EntityFinder.findDisplayName(chatModels, agentId, "agent", agentId || "智能体");
        return {
          id: agentId,
          name,
          type: "agent",
        };
      }
    }
  }

  /**
   * 解析接收者信息
   * ✅ 最佳实践：后端已确保metadata中的receiverName是显示名称，前端主要完成渲染
   * 保留容错逻辑：如果metadata中的名称是ID（向后兼容旧数据），则从chatModels查找真实名称
   */
  static resolveReceiver(
    chatModels: ChatModel[],
    metadata: Record<string, any> | null | undefined,
    selectedModelId: string | undefined
  ): {
    id: string | undefined;
    name: string;
    type: EntityType;
  } | null {
    const receiverId = metadata?.receiverId || selectedModelId;
    if (!receiverId) return null;

    const isUser = EntityId.isUserId(receiverId);
    const type: EntityType = isUser ? "user" : "agent";
    
    // ✅ 最佳实践：优先使用 metadata 中的 receiverName（后端已确保是显示名称）
    let name = metadata?.receiverName;
    
    // ✅ 容错：检查 receiverName 是否是ID（向后兼容旧数据）
    // 如果名称看起来像ID，则从 chatModels 查找真实名称
    if (name) {
      const isNameAnId = 
        name.includes("@") || 
        name === receiverId ||
        name === EntityId.extractMemberId(receiverId) ||
        name === EntityId.normalizeUserId(receiverId) ||
        name.startsWith("user::");
      
      if (isNameAnId) {
        // 名称是ID，需要从 chatModels 查找真实名称
        name = undefined; // 清空，让后续逻辑重新查找
      }
    }
    
    // 如果 name 为空或未定义，从 chatModels 查找（容错逻辑）
    if (!name) {
      const fallback = isUser 
        ? (EntityId.extractMemberId(receiverId) || receiverId)
        : receiverId;
      name = EntityFinder.findDisplayName(chatModels, receiverId, type, fallback);
    }

    return {
      id: receiverId,
      name,
      type,
    };
  }
}

