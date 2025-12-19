/**
 * 客户端模型列表获取
 * 在客户端组件中从后端 API 获取 agents 列表
 * ✅ 性能优化：使用 SWR 全局缓存，避免重复请求
 */
"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";
import type { ChatModel } from "./models";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

// 静态 agents 映射（后端静态创建的 agents）
// 注意：现在使用 agent_id（如 "chat", "rag"），而不是显示名称
const STATIC_AGENTS = ["chat", "rag"]; // 对应司仪和书吏

/**
 * 从后端获取 agents 列表（仅智能体，不包含用户）
 * ✅ 性能优化：分离智能体和用户的获取，智能体列表更稳定，加载更快
 */
export async function fetchAgentsOnly(): Promise<ChatModel[]> {
  try {
    const url = new URL(`${BACKEND_URL}/api/agents`);
    url.searchParams.set("format", "simple");
    // 不传递 user_id，只获取智能体列表
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // ✅ 性能优化：添加请求超时，避免长时间等待
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (!response.ok) {
      console.warn("Failed to fetch agents from backend, using fallback");
      return getFallbackModels();
    }

    const data = await response.json();
    const items = data.agents || [];

    // 只返回智能体（过滤掉用户）
    const agents = items
      .filter((item: any) => item.type === "agent")
      .map((item: any) => ({
        id: item.id, // agent_id（如 "chat", "rag", "Info_Hunter"）
        name: item.nickname || item.display_name, // 显示名称（如 "司仪", "书吏"）
        description: item.description || "",
        type: "agent" as const,
      }));

    // 确保至少返回默认模型
    return agents.length > 0 ? agents : getFallbackModels();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Fetch agents timeout, using fallback");
    } else {
      console.error("Error fetching agents from backend:", error);
    }
    return getFallbackModels();
  }
}

/**
 * 从后端获取用户列表（仅好友用户）
 * ✅ 性能优化：单独获取用户列表，支持更灵活的加载策略
 */
export async function fetchUsersOnly(userId: string | null): Promise<ChatModel[]> {
  if (!userId) {
    return [];
  }

  try {
    const url = new URL(`${BACKEND_URL}/api/agents`);
    url.searchParams.set("format", "simple");
    url.searchParams.set("user_id", userId);
    
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // ✅ 性能优化：用户列表可以容忍稍长的超时（好友关系可能变化）
      signal: AbortSignal.timeout(15000), // 15秒超时
    });

    if (!response.ok) {
      console.warn("Failed to fetch users from backend");
      return [];
    }

    const data = await response.json();
    const items = data.agents || [];

    // 只返回用户（过滤掉智能体）
    return items
      .filter((item: any) => item.type === "user")
      .map((item: any) => {
        const isOnline = item.is_online;
        return {
          id: item.id, // user::member_id（标准化格式）
          name: item.nickname || item.display_name, // 显示名称（昵称）
          description: "用户",
          type: "user" as const,
          isOnline: typeof isOnline === "boolean" ? isOnline : undefined,
        };
      });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Fetch users timeout");
    } else {
      console.error("Error fetching users from backend:", error);
    }
    return [];
  }
}

/**
 * 从后端获取 agents 和 users 列表（向后兼容）
 * @deprecated 建议使用 fetchAgentsOnly 和 fetchUsersOnly 分别获取
 * @param includeUsers 是否包含用户列表（仅登录用户）
 * @param userId 当前用户ID（可选），如果提供，用户列表只返回该用户的好友
 */
export async function fetchChatModels(includeUsers: boolean = false, userId?: string | null): Promise<ChatModel[]> {
  try {
    // ✅ 性能优化：分离获取智能体和用户，智能体列表更稳定
    const [agents, users] = await Promise.all([
      fetchAgentsOnly(), // 总是获取智能体列表
      includeUsers && userId ? fetchUsersOnly(userId) : Promise.resolve([]), // 按需获取用户列表
    ]);

    // 合并结果
    return [...agents, ...users];
  } catch (error) {
    console.error("Error fetching chat models:", error);
    // 即使出错，也返回智能体列表（使用后备数据）
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

// ✅ 性能优化：使用 SWR fetcher，分离智能体和用户的获取
// 智能体列表：稳定的缓存，加载快
// 用户列表：按需加载，支持实时更新
const swrAgentsFetcher = async (): Promise<ChatModel[]> => {
  return fetchAgentsOnly();
};

const swrUsersFetcher = async (key: string): Promise<ChatModel[]> => {
  // 解析缓存键：users_${userId}
  const parts = key.split("_");
  const userId = parts.slice(1).join("_"); // 支持 userId 中包含下划线的情况
  return fetchUsersOnly(userId === "none" ? null : userId);
};

// 向后兼容：统一 fetcher
const swrFetcher = async (key: string): Promise<ChatModel[]> => {
  // 解析缓存键：models_${includeUsers}_${userId}
  const parts = key.split("_");
  if (parts.length < 3) {
    // 向后兼容：如果格式不对，默认只获取智能体
    return fetchAgentsOnly();
  }
  const includeUsers = parts[1] === "true";
  const userId = parts.slice(2).join("_");
  const actualUserId = userId === "none" ? undefined : userId;
  return fetchChatModels(includeUsers, actualUserId);
};

/**
 * 清除用户列表缓存（用于刷新在线状态）
 * ✅ 性能优化：使用 SWR 的全局 mutate 清除缓存
 * @param includeUsers 是否包含用户列表
 * @param userId 用户ID（可选），如果提供，只清除该用户的缓存
 * 
 * 注意：此函数现在返回一个标记，实际清除需要在组件中使用 useSWRConfig().mutate()
 * 为了向后兼容，保留此函数，但建议直接使用 SWR 的 mutate
 */
export function clearModelsCache(includeUsers: boolean = true, userId?: string | null): string[] {
  // 返回需要清除的缓存键列表
  const keys: string[] = [];
  if (userId) {
    keys.push(`models_${includeUsers}_${userId}`);
  } else {
    // 清除所有相关缓存
    keys.push(`models_${includeUsers}_none`);
    if (includeUsers) {
      // 清除所有可能的 userId 缓存（需要调用方处理）
      keys.push(`models_${includeUsers}_*`);
    }
  }
  return keys;
}

/**
 * React Hook：获取智能体列表（仅智能体，不包含用户）
 * ✅ 性能优化：智能体列表稳定，加载快，缓存时间长
 * ✅ 优化：优先加载静态智能体，动态智能体异步加载
 */
export function useAgents() {
  // ✅ 优化：分离静态和动态智能体的加载
  // 静态智能体：立即加载（最快）
  // 动态智能体：异步加载（次之）
  const { data: allAgents, isLoading: allLoading } = useSWR<ChatModel[]>(
    "agents_only", // 全局缓存键，所有组件共享
    swrAgentsFetcher,
    {
      fallbackData: getFallbackModels(), // 立即返回后备数据
      revalidateOnFocus: false, // 智能体列表变化不频繁，禁用 focus 刷新
      revalidateOnReconnect: true, // 网络重连时刷新
      dedupingInterval: 10000, // 10秒内的重复请求会被去重（智能体列表稳定）
      refreshInterval: 0, // 禁用自动轮询
      keepPreviousData: true,
    }
  );

  // ✅ 优化：分离静态和动态智能体（前端处理，不增加后端请求）
  const models = useMemo(() => {
    if (!allAgents) return getFallbackModels();
    
    // 静态智能体通常是系统内置的，如 "chat", "rag"
    const staticAgentIds = ["chat", "rag"];
    const staticAgents = allAgents.filter(agent => staticAgentIds.includes(agent.id));
    const dynamicAgents = allAgents.filter(agent => !staticAgentIds.includes(agent.id));
    
    // 静态在前，动态在后（静态智能体优先显示）
    return [...staticAgents, ...dynamicAgents];
  }, [allAgents]);

  return {
    models,
    loading: allLoading,
  };
}

/**
 * React Hook：获取用户列表（仅好友用户）
 * ✅ 性能优化：用户列表按需加载，支持实时更新
 * ✅ 优化：减少去重间隔，提高加载速度
 */
export function useUsers(userId: string | null, refreshKey: number = 0) {
  const cacheKey = userId ? `users_${userId}` : null;
  const { data, isLoading, mutate } = useSWR<ChatModel[]>(
    cacheKey,
    cacheKey ? swrUsersFetcher : null, // 只有 userId 存在时才请求
    {
      fallbackData: [], // 用户列表默认为空
      revalidateOnFocus: true, // 用户列表变化较频繁，focus 时刷新
      revalidateOnReconnect: true,
      dedupingInterval: 2000, // ✅ 优化：2秒内的重复请求会被去重（减少请求频率）
      refreshInterval: 0,
      keepPreviousData: true,
    }
  );

  // ✅ 性能优化：当 refreshKey 变化时，手动触发重新验证
  useEffect(() => {
    if (refreshKey > 0 && cacheKey) {
      mutate(undefined, { revalidate: true });
    }
  }, [refreshKey, mutate, cacheKey]);

  return {
    models: data || [],
    loading: isLoading,
  };
}

/**
 * React Hook：在客户端组件中获取模型列表（智能体 + 用户）
 * ✅ 性能优化：分离智能体和用户的获取，智能体列表更稳定，加载更快
 * @param includeUsers 是否包含用户列表（仅登录用户）
 * @param refreshKey 刷新键，改变时会强制重新获取（用于刷新在线状态）
 * @param userId 当前用户ID（可选），如果提供，用户列表只返回该用户的好友
 */
export function useChatModels(includeUsers: boolean = false, refreshKey: number = 0, userId?: string | null) {
  // ✅ 性能优化：分离获取智能体和用户
  // 智能体列表：稳定，加载快，缓存时间长
  // 用户列表：按需加载，支持实时更新
  const { models: agents, loading: agentsLoading } = useAgents();
  const { models: users, loading: usersLoading } = useUsers(
    includeUsers ? (userId || null) : null,
    refreshKey
  );

  // 合并智能体和用户列表
  const models = useMemo(() => {
    return includeUsers ? [...agents, ...users] : agents;
  }, [agents, users, includeUsers]);

  return {
    models,
    loading: agentsLoading || (includeUsers && usersLoading),
  };
}

