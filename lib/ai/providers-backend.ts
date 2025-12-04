/**
 * 后端 Agent Provider
 * 使用后端 agno 框架提供的 agents，替代 Vercel AI Gateway
 */
import { customProvider } from "ai";
import { createBackendLanguageModel } from "./backend-model";

/**
 * 后端 Agent Provider
 * 所有模型调用都转发到后端 API
 * 支持动态的 agent 名称（如：司仪、书吏）
 */
export const backendProvider = customProvider({
  languageModels: {
    // 静态 agents
    "司仪": createBackendLanguageModel("司仪"),
    "书吏": createBackendLanguageModel("书吏"),
    // 向后兼容的模型 ID（映射到司仪）
    "chat-model": createBackendLanguageModel("司仪"),
    "chat-model-reasoning": createBackendLanguageModel("司仪"),
    "title-model": createBackendLanguageModel("司仪"), // 标题生成使用司仪
    "artifact-model": createBackendLanguageModel("司仪"), // 文档生成使用司仪
  },
});

