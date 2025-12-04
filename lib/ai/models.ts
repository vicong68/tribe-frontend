export const DEFAULT_CHAT_MODEL: string = "司仪";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  type?: "agent" | "user"; // 类型：智能体或用户
  isOnline?: boolean; // 用户在线状态（仅用户类型）
};

// 静态 agents 映射（后端静态创建的 agents）
const STATIC_AGENTS = ["chat", "rag"]; // 对应司仪和书吏

// 从后端获取 agents 列表
async function fetchAgentsFromBackend(): Promise<ChatModel[]> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
  
  try {
    const response = await fetch(`${backendUrl}/api/chat/agents`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // 在服务端组件中，可以设置 cache
      cache: "no-store", // 或者使用 "force-cache" 进行缓存
    });

    if (!response.ok) {
      console.warn("Failed to fetch agents from backend, using fallback");
      return getFallbackModels();
    }

    const data = await response.json();
    const agents = data.agents || [];

    // 过滤出静态 agents（chat 和 rag），并映射为模型格式
    const staticAgents = agents.filter((agent: any) => 
      STATIC_AGENTS.includes(agent.name)
    );

    // 转换为 ChatModel 格式
    const models: ChatModel[] = staticAgents.map((agent: any) => {
      // 使用第一个显示名称作为模型名称
      const displayName = agent.display_names?.[0] || agent.chinese_names?.[0] || agent.name;
      
      return {
        id: displayName, // 使用显示名称作为 ID（如：司仪、书吏）
        name: displayName,
        description: agent.description || "",
      };
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

// 后备模型列表（当无法从后端获取时使用）
function getFallbackModels(): ChatModel[] {
  return [
    {
      id: "司仪",
      name: "司仪",
      description: "普通聊天助手，可以进行日常对话",
    },
    {
      id: "书吏",
      name: "书吏",
      description: "知识库问答助手，基于上传的文件进行智能问答",
    },
  ];
}

// 导出模型列表（在服务端组件中使用）
export async function getChatModels(): Promise<ChatModel[]> {
  return await fetchAgentsFromBackend();
}

// 客户端使用的模型列表（使用后备列表，客户端组件会通过 API 获取）
export const chatModels: ChatModel[] = getFallbackModels();
