/**
 * 客户端模型列表获取
 * 在客户端组件中从后端 API 获取 agents 列表
 */
"use client";

import { useEffect, useState } from "react";
import type { ChatModel } from "./models";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

// 静态 agents 映射（后端静态创建的 agents）
const STATIC_AGENTS = ["chat", "rag"]; // 对应司仪和书吏

/**
 * 从后端获取 agents 和 users 列表
 * @param includeUsers 是否包含用户列表（仅登录用户）
 */
export async function fetchChatModels(includeUsers: boolean = false): Promise<ChatModel[]> {
  try {
    // 获取 agents 列表（使用 simple 格式，包含所有 agents 和 users）
    const response = await fetch(`${BACKEND_URL}/api/agents?format=simple`, {
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

    // 转换为 ChatModel 格式
    const models: ChatModel[] = items
      .filter((item: any) => {
        // 如果不需要用户，过滤掉用户类型
        if (!includeUsers && item.type === "user") {
          return false;
        }
        // 如果需要用户，包含所有类型
        // 对于agents，只包含静态agents（向后兼容）
        if (item.type === "agent") {
          return STATIC_AGENTS.includes(item.id);
        }
        return true;
      })
      .map((item: any) => {
        if (item.type === "user") {
          // 用户类型
          return {
            id: item.id, // user::member_id
            name: item.nickname,
            description: "用户",
            type: "user" as const,
            isOnline: item.is_online || false, // 从后端获取在线状态
          };
        } else {
          // Agent 类型 - 需要获取描述信息
          // 尝试从详细格式API获取描述
          return {
            id: item.nickname, // 使用显示名称作为 ID（如：司仪、书吏）
            name: item.nickname,
            description: item.description || "", // simple 格式可能不包含描述
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
 */
function getFallbackModels(): ChatModel[] {
  return [
    {
      id: "司仪",
      name: "司仪",
      description: "普通聊天助手，可以进行日常对话",
      type: "agent",
    },
    {
      id: "书吏",
      name: "书吏",
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
 * React Hook：在客户端组件中获取模型列表
 * 使用模块级缓存和请求去重，避免重复查询
 * @param includeUsers 是否包含用户列表（仅登录用户）
 */
export function useChatModels(includeUsers: boolean = false) {
  const [models, setModels] = useState<ChatModel[]>(getFallbackModels());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cacheKey = `models_${includeUsers}`;
    const cached = modelsCache[cacheKey];
    const now = Date.now();
    
    // 如果缓存有效，直接使用
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
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
      console.log("[useChatModels] Fetching models, includeUsers:", includeUsers);
    }
    const fetchPromise = fetchChatModels(includeUsers)
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
  }, [includeUsers]);

  return { models, loading };
}

