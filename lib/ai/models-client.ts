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

/**
 * React Hook：在客户端组件中获取模型列表
 * @param includeUsers 是否包含用户列表（仅登录用户）
 */
export function useChatModels(includeUsers: boolean = false) {
  const [models, setModels] = useState<ChatModel[]>(getFallbackModels());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("[useChatModels] Fetching models, includeUsers:", includeUsers);
    fetchChatModels(includeUsers)
      .then((fetchedModels) => {
        console.log("[useChatModels] Fetched models:", fetchedModels.map(m => ({ id: m.id, name: m.name, type: m.type })));
        setModels(fetchedModels);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to fetch chat models:", error);
        setLoading(false);
      });
  }, [includeUsers]);

  return { models, loading };
}

