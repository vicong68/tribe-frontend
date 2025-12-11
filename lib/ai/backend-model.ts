/**
 * 后端 Agent 语言模型包装器
 * 将 AI SDK 的模型调用转发到后端 API
 * 
 * 注意：这是一个简化的实现，直接使用后端 API 的 SSE 流
 * 后端 API 返回的是 AI SDK Data Stream Protocol 格式
 */
import type { LanguageModelV2 } from "ai";
import { generateSessionId } from "@/lib/session-utils";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 处理转义字符的工具函数
 */
function unescapeText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * 创建完成事件响应对象
 */
function createFinishResponse(
  text: string,
  finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other",
  usage: { promptTokens: number; completionTokens: number },
  responseId: string,
  agentName: string,
  timestamp?: Date
) {
  return {
    finishReason,
    usage,
    content: [{ type: "text" as const, text }],
    response: {
      id: responseId,
      timestamp: timestamp || new Date(),
      model: agentName,
      provider: "backend" as const,
    },
    rawCall: {
      rawPrompt: null,
      rawSettings: {},
    },
    warnings: [] as string[],
  };
}

/**
 * 创建后端语言模型包装器
 * @param agentName Agent 名称（如：司仪、书吏、猎手等）
 */
export function createBackendLanguageModel(
  agentName: string
): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "backend",
    modelId: agentName,
    defaultObjectGenerationMode: "tool",
    supportedUrls: [],
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    doStream: async (options) => {
      const { prompt, messages, maxTokens, temperature } = options;

      // 处理 messages：优先使用 prompt（如果存在且非空），否则使用 messages
      let processedMessages: Array<{ role: string; content: string }> = [];
      
      // 优先处理 prompt（generateText 通常使用 prompt）
      if (prompt) {
        // 检查 prompt 是否是消息数组（AI SDK 可能将 system + prompt 合并为消息数组）
        if (
          Array.isArray(prompt) &&
          prompt.length > 0 &&
          typeof prompt[0] === "object" &&
          prompt[0] !== null &&
          "role" in prompt[0]
        ) {
          // prompt 是消息数组，直接处理（包含 system 和 user 消息）
          processedMessages = prompt.map((msg: any) => {
            let content = "";
            if (typeof msg.content === "string") {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              // 处理 content 是数组的情况（如 [{ type: 'text', text: '...' }]）
              content = msg.content
                .map((part: any) => {
                  if (part && typeof part === "object" && part.type === "text") {
                    return part.text || "";
                  }
                  return "";
                })
                .join("");
            } else {
              content = String(msg.content || "");
            }
            
            return {
              role: msg.role,
              content: content,
            };
          });
        } else {
          // prompt 是字符串或字符串数组，构建用户消息
          const promptContent =
            typeof prompt === "string"
              ? prompt
              : Array.isArray(prompt)
                ? prompt
                    .map((part: any) => {
                      if (part.type === "text") {
                        return part.text || "";
                      }
                      return "";
                    })
                    .join("")
                : String(prompt || "");
          
          if (!promptContent || promptContent.trim().length === 0) {
            throw new Error("Prompt content cannot be empty");
          }
          
          processedMessages = [
            {
              role: "user",
              content: promptContent,
            },
          ];
        }
      } else if (messages && Array.isArray(messages) && messages.length > 0) {
        // 如果没有 prompt，使用提供的 messages
        processedMessages = messages.map((msg) => {
          let content = "";
          if (typeof msg.content === "string") {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content
              .map((part) => {
                if (part.type === "text") {
                  return part.text || "";
                }
                return "";
              })
              .join("");
          } else {
            content = String(msg.content || "");
          }
          
          return {
            role: msg.role,
            content: content,
          };
        });
      } else {
        throw new Error("Either messages or prompt must be provided");
      }
      
      // 验证处理后的消息不为空
      if (processedMessages.length === 0) {
        throw new Error("Processed messages cannot be empty");
      }
      
      // 验证至少有一条消息有非空内容
      const hasValidContent = processedMessages.some(
        (msg) => msg.content && msg.content.trim().length > 0
      );
      if (!hasValidContent) {
        throw new Error("At least one message must have non-empty content");
      }

      // 注意：如果 prompt 已经是消息数组（包含 system 消息），则不需要再添加 system
      // 检查是否已经有 system 消息
      const hasSystemMessage = processedMessages.some((msg) => msg.role === "system");
      
      // 添加系统提示词（如果提供了 system 参数且还没有 system 消息）
      if (options.system && !hasSystemMessage) {
        const systemContent =
          typeof options.system === "string"
            ? options.system
            : Array.isArray(options.system)
              ? options.system
                  .map((part) => {
                    if (part.type === "text") {
                      return part.text;
                    }
                    return "";
                  })
                  .join("")
              : String(options.system);
        
        processedMessages.unshift({
          role: "system",
          content: systemContent,
        });
      }

      // 构建请求体（符合后端 API 格式）
      // 生成统一的 session_id（确保对话记忆隔离，双方顺序一致）
      // 注意：AI SDK 的 generateText 不支持直接传递 userId 和 conversationId
      // 需要通过 providerOptions.backend 传递这些参数
      const providerOptions = (options as any).providerOptions;
      const backendOptions = providerOptions?.backend || {};
      const userId = backendOptions.userId || (options as any).userId || "temp_user";
      const conversationId = backendOptions.conversationId || (options as any).conversationId || generateSessionId(userId, agentName);
      
      // 确保 messages 是数组格式（符合后端 API 要求）
      if (!Array.isArray(processedMessages)) {
        throw new Error("Processed messages must be an array");
      }
      
      const requestBody = {
        messages: processedMessages, // 数组格式：[{ role: 'system', content: '...' }, { role: 'user', content: '...' }]
        agent_id: agentName, // 使用 agent_id 作为规范标识
        member_id: userId, // 使用传入的 userId（可能是后端 member_id）
        conversation_id: conversationId,
        use_knowledge_base: false,
        knowledge_file_ids: undefined,
        context_ids: undefined,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: true,
      };

      // 调用后端 API
      const response = await fetch(`${BACKEND_API_URL}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Backend API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // 后端返回的是 AI SDK Data Stream Protocol 格式的 SSE 流
      // 返回流式响应（v2 格式）
      return {
        stream: response.body!,
        rawCall: {
          rawPrompt: null,
          rawSettings: {},
        },
      };
    },
    doGenerate: async (options) => {
      // 对于非流式生成，使用流式接口但等待完成
      // doStream 已经处理了 messages 和 prompt 的情况
      const streamResult = await createBackendLanguageModel(agentName).doStream(
        options
      );

      // 收集所有文本内容
      let text = "";
      let finishEventReceived = false;
      let finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" = "stop";
      let usage = {
        promptTokens: 0,
        completionTokens: 0,
      };
      let responseId = "unknown";
      
      const reader = streamResult.stream.getReader();
      const decoder = new TextDecoder();
      
      // 添加超时机制（30秒，标题生成应该很快）
      const timeout = 30000; // 30秒
      const startTime = Date.now();
      
      if (process.env.NODE_ENV === "development") {
        console.log(`[backend-model] 🔄 开始 doGenerate (agent: ${agentName})`);
      }

      try {
        while (true) {
          // 检查超时
          if (Date.now() - startTime > timeout) {
            console.error(`[backend-model] ⚠️ 生成超时 (${timeout}ms), agent: ${agentName}, textSoFar: ${text.substring(0, 50)}`);
            break;
          }
          
          const { done, value } = await reader.read();
          if (done) break;
          
          // 解析 SSE 格式的数据
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (!line.trim()) continue; // 跳过空行
            
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              
              // 解析完成事件（Data Stream Protocol 格式：d:{...}）
              if (data.startsWith('d:')) {
                try {
                  const finishData = JSON.parse(data.slice(2));
                  finishEventReceived = true;
                  finishReason = (finishData.finishReason || "stop") as typeof finishReason;
                  usage = finishData.usage || usage;
                  responseId = finishData.id || responseId;
                  
                  return createFinishResponse(
                    finishData.text || text || "",
                    finishReason,
                    usage,
                    responseId,
                    agentName,
                    finishData.timestamp ? new Date(finishData.timestamp) : undefined
                  );
                } catch (parseError) {
                  console.error(`[backend-model] ⚠️ 解析完成事件失败:`, {
                    error: parseError,
                    data: data.slice(0, 200),
                    agent: agentName,
                  });
                }
              } 
              // 解析 JSON SSE 格式：{"type": "finish" | "text-delta" | "text", ...}
              else if (data.trim().startsWith('{')) {
                try {
                  const jsonData = JSON.parse(data);
                  if (jsonData.type === "finish") {
                    finishEventReceived = true;
                    finishReason = (jsonData.finishReason || "stop") as typeof finishReason;
                    usage = jsonData.usage || usage;
                    responseId = jsonData.id || responseId;
                    
                    return createFinishResponse(
                      text || "",
                      finishReason,
                      usage,
                      responseId,
                      agentName,
                      jsonData.timestamp ? new Date(jsonData.timestamp) : undefined
                    );
                  } else if (jsonData.type === "text-delta" && jsonData.textDelta) {
                    text += jsonData.textDelta;
                  } else if (jsonData.type === "text" && jsonData.text) {
                    text = jsonData.text;
                  }
                } catch (parseError) {
                  if (process.env.NODE_ENV === "development") {
                    console.warn(`[backend-model] ⚠️ 无法解析 JSON 数据:`, {
                      error: parseError,
                      data: data.substring(0, 100),
                      agent: agentName,
                    });
                  }
                }
              } 
              // 解析文本增量（Data Stream Protocol 格式：0:"text"）
              else if (data.match(/^\d+:"/)) {
                // 文本增量：0:"text" 或 0:"text\nmore"（Data Stream Protocol 格式）
                const match = data.match(/^\d+:"(.+)"$/s) || data.match(/^\d+:"([\s\S]*?)"$/);
                if (match) {
                  text += unescapeText(match[1]);
                } else if (process.env.NODE_ENV === "development") {
                  console.warn(`[backend-model] ⚠️ 无法解析文本增量:`, {
                    data: data.substring(0, 100),
                    agent: agentName,
                  });
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`[backend-model] ❌ 流式读取异常:`, {
          error: error instanceof Error ? error.message : String(error),
          agent: agentName,
          textSoFar: text.substring(0, 100),
        });
        throw error; // 重新抛出错误
      } finally {
        reader.releaseLock();
      }

      // 如果没有收到完成事件但有文本，返回收集的文本
      if (text) {
        const duration = Date.now() - startTime;
        console.log(`[backend-model] ✅ 流式完成，未收到完成事件但有文本 (${text.length} chars, ${duration}ms), agent: ${agentName}`);
        return {
          finishReason: finishEventReceived ? finishReason : "stop",
          usage,
          content: [{ type: "text", text }],
          response: {
            id: responseId,
            timestamp: new Date(),
            model: agentName,
            provider: "backend",
          },
          rawCall: {
            rawPrompt: null,
            rawSettings: {},
          },
          warnings: finishEventReceived ? [] : ["未收到完成事件，可能流被中断"],
        };
      }
      
      // 如果既没有完成事件也没有文本，抛出错误
      const duration = Date.now() - startTime;
      console.error(`[backend-model] ❌ 生成失败：未收到任何有效响应 (agent: ${agentName}, duration: ${duration}ms, finishEventReceived: ${finishEventReceived})`);
      throw new Error(`生成失败：未收到任何有效响应 (agent: ${agentName}, duration: ${duration}ms)`);
    },
  };
}

