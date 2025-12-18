/**
 * 客户端模型列表获取
 * 在客户端组件中从后端 API 获取 agents 列表
 */
"use client";

import { useEffect, useState } from "react";
import type { ChatModel } from "./models";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

// 静态 agents 映射（后端静态创建的 agents）
// 注意：现在使用 agent_id（如 "chat", "rag"），而不是显示名称
const STATIC_AGENTS = ["chat", "rag"]; // 对应司仪和书吏

/**
 * 从后端获取 agents 和 users 列表
 * @param includeUsers 是否包含用户列表（仅登录用户）
 * @param userId 当前用户ID（可选），如果提供，用户列表只返回该用户的好友
 */
export async function fetchChatModels(includeUsers: boolean = false, userId?: string | null): Promise<ChatModel[]> {
  try {
    // ✅ 优化：如果提供了userId，传递到后端，确保只返回好友（与好友列表一致）
    const url = new URL(`${BACKEND_URL}/api/agents`);
    url.searchParams.set("format", "simple");
    if (userId) {
      url.searchParams.set("user_id", userId);
    }
    
    // 获取 agents 列表（使用 simple 格式，包含所有 agents 和 users）
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn("Failed to fetch agents from backend, using fallback");
      return getFallbackModels();
    }

    const data = await response.json();
    const items = data.agents || [];

    // 转换为 ChatModel 格式（标准化：统一使用 agent_id）
    // 注意：现在包含所有agents（静态、动态），不再过滤
    const models: ChatModel[] = items
      .filter((item: any) => {
        // 如果不需要用户，过滤掉用户类型
        if (!includeUsers && item.type === "user") {
          return false;
        }
        // 对于agents，包含所有类型（静态、动态），不再过滤
        return true;
      })
      .map((item: any) => {
        if (item.type === "user") {
          // 用户类型：统一使用 user::member_id 格式
          // 在线状态：true=在线，false=离线，undefined=状态不可知
          const isOnline = item.is_online;
          return {
            id: item.id, // user::member_id（标准化格式）
            name: item.nickname || item.display_name, // 显示名称（昵称）
            description: "用户",
            type: "user" as const,
            isOnline: typeof isOnline === "boolean" ? isOnline : undefined, // 保持 undefined 表示状态不可知
          };
        } else {
          // Agent 类型：统一使用 agent_id（如 "chat", "rag", "Info_Hunter"）
          return {
            id: item.id, // 统一使用 agent_id（标准化：如 "chat", "rag", "Info_Hunter"）
            name: item.nickname || item.display_name, // 显示名称（用于UI展示，如 "司仪", "书吏"）
            description: item.description || "", // 描述信息
            type: "agent" as const,
          };
        }
      });

    // 确保至少返回默认模型
    if (models.length === 0) {
      return getFallbackModels();
    }

    return models;
  } catch (error) {
    console.error("Error fetching agents from backend:", error);
    return getFallbackModels();
  }
}

/**
 * 后备模型列表（当无法从后端获取时使用）
 * 标准化：使用 agent_id 作为 id
 */
function getFallbackModels(): ChatModel[] {
  return [
    {
      id: "chat", // 标准化：使用 agent_id
      name: "司仪", // 显示名称
      description: "普通聊天助手，可以进行日常对话",
      type: "agent",
    },
    {
      id: "rag", // 标准化：使用 agent_id
      name: "书吏", // 显示名称
      description: "知识库问答助手，基于上传的文件进行智能问答",
      type: "agent",
    },
  ];
}

// 模块级缓存，避免跨组件重复查询
const modelsCache: Record<string, { models: ChatModel[]; timestamp: number }> = {};
// 正在进行的请求，用于去重（防止多个组件同时发起相同查询）
const pendingRequests: Record<string, Promise<ChatModel[]>> = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

/**
 * 清除用户列表缓存（用于刷新在线状态）
 * @param includeUsers 是否包含用户列表
 * @param userId 用户ID（可选），如果提供，只清除该用户的缓存
 */
export function clearModelsCache(includeUsers: boolean = true, userId?: string | null) {
  // ✅ 优化：如果提供了userId，只清除该用户的缓存；否则清除所有相关缓存
  if (userId) {
    const cacheKey = `models_${includeUsers}_${userId}`;
    delete modelsCache[cacheKey];
  } else {
    // 清除所有相关缓存（向后兼容）
    const cacheKey = `models_${includeUsers}`;
    delete modelsCache[cacheKey];
    // 如果清除用户列表缓存，也清除包含用户的缓存
    if (includeUsers) {
      delete modelsCache["models_true"];
      // ✅ 清除所有可能的userId缓存（使用通配符匹配）
      Object.keys(modelsCache).forEach((key) => {
        if (key.startsWith(`models_${includeUsers}_`)) {
          delete modelsCache[key];
        }
      });
    }
  }
}

/**
 * React Hook：在客户端组件中获取模型列表
 * 使用模块级缓存和请求去重，避免重复查询
 * @param includeUsers 是否包含用户列表（仅登录用户）
 * @param refreshKey 刷新键，改变时会强制重新获取（用于刷新在线状态）
 * @param userId 当前用户ID（可选），如果提供，用户列表只返回该用户的好友
 */
export function useChatModels(includeUsers: boolean = false, refreshKey: number = 0, userId?: string | null) {
  const [models, setModels] = useState<ChatModel[]>(getFallbackModels());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ✅ 优化：将userId包含在缓存键中，确保不同用户的好友列表不混淆
    const cacheKey = `models_${includeUsers}_${userId || 'none'}`;
    const cached = modelsCache[cacheKey];
    const now = Date.now();
    
    // 如果 refreshKey > 0，表示需要强制刷新，跳过缓存检查
    const shouldUseCache = refreshKey === 0 && cached && (now - cached.timestamp) < CACHE_DURATION;
    
    // 如果缓存有效且不需要强制刷新，直接使用
    if (shouldUseCache) {
      setModels(cached.models);
      setLoading(false);
      return;
    }

    // 如果已有相同请求正在进行，等待该请求完成
    if (pendingRequests[cacheKey]) {
      pendingRequests[cacheKey]
        .then((fetchedModels) => {
          setModels(fetchedModels);
          setLoading(false);
        })
        .catch((error) => {
          console.error("Failed to fetch chat models (from pending request):", error);
          setLoading(false);
        });
      return;
    }

    // 发起新请求（仅在开发环境且首次查询时输出日志）
    if (process.env.NODE_ENV === "development" && !cached) {
      console.log("[useChatModels] Fetching models, includeUsers:", includeUsers, "userId:", userId);
    }
    const fetchPromise = fetchChatModels(includeUsers, userId)
      .then((fetchedModels) => {
        // 仅在开发环境输出详细日志（减少日志噪音）
        if (process.env.NODE_ENV === "development") {
          console.log("[useChatModels] Fetched models:", fetchedModels.map(m => ({ id: m.id, name: m.name, type: m.type })));
        }
        // 更新缓存
        modelsCache[cacheKey] = { models: fetchedModels, timestamp: now };
        // 清除待处理请求
        delete pendingRequests[cacheKey];
        return fetchedModels;
      })
      .catch((error) => {
        console.error("Failed to fetch chat models:", error);
        // 清除待处理请求
        delete pendingRequests[cacheKey];
        throw error;
      });

    // 保存待处理请求
    pendingRequests[cacheKey] = fetchPromise;

    // 更新状态
    fetchPromise
      .then((fetchedModels) => {
        setModels(fetchedModels);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [includeUsers, refreshKey, userId]); // ✅ 添加 userId 作为依赖

  return { models, loading };
}

