/**
 * 后端 Agent Provider
 * 使用后端 agno 框架提供的 agents，替代 Vercel AI Gateway
 */
import { customProvider } from "ai";
import { createBackendLanguageModel } from "./backend-model";

/**
 * 后端 Agent Provider
 * 所有模型调用都转发到后端 API
 * 标准化：使用 agent_id（如 "chat", "rag"）作为 key
 */
export const backendProvider = customProvider({
  languageModels: {
    // 标准化：使用 agent_id 作为 key
    "chat": createBackendLanguageModel("chat"), // 对应 "司仪"
    "rag": createBackendLanguageModel("rag"), // 对应 "书吏"
    // 向后兼容：显示名称映射（保持兼容性）
    "司仪": createBackendLanguageModel("chat"),
    "书吏": createBackendLanguageModel("rag"),
    // 向后兼容的模型 ID（映射到 chat）
    "chat-model": createBackendLanguageModel("chat"),
    "chat-model-reasoning": createBackendLanguageModel("chat"),
    "title-model": createBackendLanguageModel("chat"), // 标题生成使用 chat
    "artifact-model": createBackendLanguageModel("chat"), // 文档生成使用 chat
  },
});

