import { auth, type UserType } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import type { ChatModel } from "@/lib/ai/models";
import {
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import { generateSessionId } from "@/lib/session-utils";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID, getTextFromMessage } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

// 记录后端 URL 配置（用于调试）
if (typeof process !== "undefined" && process.env) {
  console.log("[chat/route] Backend API URL:", BACKEND_API_URL);
}

export const maxDuration = 60;

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    // 记录详细的验证错误信息（生产环境也需要日志）
    console.error("[chat/route] Request validation failed:", error);
    if (error instanceof Error) {
      console.error("[chat/route] Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }
    // 如果是 Zod 验证错误，记录具体字段
    if (error && typeof error === "object" && "issues" in error) {
      console.error("[chat/route] Validation issues:", (error as any).issues);
    }
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel["id"];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      // Only fetch messages if chat already exists
      messagesFromDb = await getMessagesByChatId({ id });
    } else {
      // 生成标题（新聊天时）
      // 只有在消息有文本内容时才生成标题
      
      // 调试：检查 message 对象结构
      console.log("[chat/route] Title generation - message object:", {
        hasParts: !!message.parts,
        partsLength: message.parts?.length || 0,
        parts: message.parts,
        messageId: message.id,
        role: message.role,
      });
      
      // 检查是否有文件附件
      const hasFileAttachments = message.parts?.some((part) => part.type === "file") || false;
      
      const messageText = getTextFromMessage(message);
      
      // 调试：检查提取的文本
      console.log("[chat/route] Title generation - extracted text:", {
        messageText,
        textLength: messageText?.length || 0,
        trimmedLength: messageText?.trim().length || 0,
        hasFileAttachments,
      });
      
      let title = "新对话";
      // 验证消息文本不为空（如果有文件附件但没有文本，也跳过标题生成）
      if (messageText && messageText.trim().length > 0) {
        try {
          // 生成临时 conversationId 用于标题生成
          // 注意：标题生成使用后端 member_id 确保一致性
          const backendMemberId = session.user.type === "guest" 
            ? "guest_user"
            : (session.user.memberId || session.user.email?.split("@")[0] || session.user.id);
          const titleConversationId = `title_${backendMemberId}_${Date.now()}`;
          
          title = await generateTitleFromUserMessage({
        message,
            userId: backendMemberId, // 使用后端 member_id
            conversationId: titleConversationId,
          });
        } catch (error) {
          // 如果标题生成失败，使用默认标题
          console.error("[chat/route] Failed to generate title:", error);
          title = "新对话";
        }
      } else {
        console.warn("[chat/route] Message text is empty, skipping title generation", {
          messageText,
          parts: message.parts,
        });
      }

      try {
        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      } catch (error) {
        // 如果保存聊天失败，记录错误但继续执行（允许用户发送消息）
        console.error("[chat/route] Failed to save chat:", {
          error,
          chatId: id,
          userId: session.user.id,
          title,
        });
        // 检查是否是重复插入错误（聊天已存在）
        if (error instanceof ChatSDKError && error.type === "bad_request" && error.surface === "database") {
          // 如果是重复插入或外键约束错误，允许继续（聊天可能已存在或用户可能不存在）
          if (
            error.message?.includes("already exists") ||
            error.message?.includes("duplicate") ||
            error.message?.includes("用户不存在") ||
            error.message?.includes("foreign key")
          ) {
            console.warn("[chat/route] Chat save failed (may already exist or user issue), continuing...", {
              error: error.message,
              chatId: id,
              userId: session.user.id,
            });
            // 不抛出错误，允许继续处理消息
          } else {
            // 其他数据库错误，记录但继续执行（避免阻塞用户）
            console.error("[chat/route] Database error when saving chat, but continuing:", error);
            // 不抛出错误，允许继续处理消息
          }
        } else {
          // 非 ChatSDKError 错误，记录但继续执行
          console.error("[chat/route] Unexpected error when saving chat, but continuing:", error);
          // 不抛出错误，允许继续处理消息
        }
      }
      // New chat - no need to fetch messages, it's empty
    }

    // 保存用户消息到数据库
    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: "user",
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    // 构建后端 API 请求体
    // 提取最后一条用户消息的内容（使用统一的工具函数）
    const messageContent = getTextFromMessage(message);
    
    // 提取文件附件信息
    const fileParts = message.parts?.filter((part) => part.type === "file") || [];
    const fileAttachment = fileParts.length > 0 ? {
      file_id: fileParts[0].url, // 使用URL作为file_id
      download_url: fileParts[0].url,
      file_name: fileParts[0].name || fileParts[0].filename || "file",
      file_type: fileParts[0].mediaType || fileParts[0].contentType || "application/octet-stream",
    } : undefined;

    // 构建历史消息（转换为后端格式）
    // 先将 DBMessage 转换为 ChatMessage 格式，以便 getTextFromMessage 正确处理
    const convertedMessages = convertToUIMessages(messagesFromDb);
    const historyMessages = convertedMessages.map((msg) => ({
      role: msg.role,
      content: getTextFromMessage(msg),
    }));

    // 添加当前用户消息
    const allMessages = [
      ...historyMessages,
      {
        role: "user" as const,
        content: messageContent,
      },
    ];

    // 构建后端请求体（符合 AI SDK 格式）
    // 根据用户类型确定登录状态
    const loginStatus = session.user.type === "guest" ? "未登录" : "已登录";
    
    // 获取后端用户 ID（member_id）
    // 优先使用 session 中存储的 memberId，如果没有则从 email 提取（格式：member_id@qq.com）
    // 对于访客用户，使用 "guest_user"
    let backendMemberId: string;
    if (session.user.type === "guest") {
      backendMemberId = "guest_user";
    } else if (session.user.memberId) {
      // 使用 session 中存储的后端用户 ID
      backendMemberId = session.user.memberId;
    } else if (session.user.email) {
      // 从 email 提取 member_id（格式：member_id@qq.com）
      backendMemberId = session.user.email.split("@")[0];
    } else {
      // 如果都没有，使用前端 UUID（向后兼容，但不推荐）
      console.warn("[chat/route] 无法获取后端 member_id，使用前端 UUID:", session.user.id);
      backendMemberId = session.user.id;
    }
    
    // 判断是用户-用户对话还是用户-Agent对话
    const isUserToUser = selectedChatModel.startsWith("user::");
    const targetType = isUserToUser ? "user" : "agent";
    
    // 提取目标ID（如果是用户，去掉"user::"前缀）
    const targetId = isUserToUser 
      ? selectedChatModel.replace(/^user::/, "") 
      : selectedChatModel;
    
    // 生成统一的 session_id（确保对话记忆隔离，双方顺序一致）
    // 格式：session_{participant1}_{participant2}，按字母序排序
    // 注意：使用后端 member_id 而不是前端 UUID，确保对话记忆一致性
    const sessionId = generateSessionId(backendMemberId, selectedChatModel);
    
    // 调试日志
    console.log("[chat/route] Generating session_id:", {
      frontendUserId: session.user.id,
      backendMemberId,
      selectedChatModel,
      targetType,
      targetId,
      sessionId,
      chatId: id,
    });
    
    // 构建后端请求体
    const backendRequestBody: any = {
      messages: allMessages,
      member_id: backendMemberId, // 使用后端用户 ID
      conversation_id: sessionId, // 使用统一的 session_id 格式
      login_status: loginStatus, // 从 session 获取实际登录状态
      stream: true,
      use_knowledge_base: false,
      knowledge_file_ids: undefined,
      context_ids: undefined,
    };
    
    // 根据目标类型设置不同的字段
    if (isUserToUser) {
      // 用户-用户对话：使用 target_id 和 target_type
      backendRequestBody.target_id = targetId;
      backendRequestBody.target_type = "user";
    } else {
      // 用户-Agent对话：使用 agent_id（向后兼容）
      backendRequestBody.agent_id = targetId; // Agent ID（规范标识，如：司仪、书吏等）
      backendRequestBody.target_type = "agent";
    }
    
    console.log("[chat/route] Backend request body:", JSON.stringify(backendRequestBody, null, 2));

    // 用户-用户消息使用非流式接口，Agent消息使用流式接口
    if (isUserToUser) {
      // 用户-用户消息：使用非流式的 /api/chat 接口（同步模式）
      try {
        const backendUrl = `${BACKEND_API_URL}/api/chat?async_mode=false`;
        console.log("[chat/route] User-to-user message, using non-streaming API:", backendUrl);
        
        const backendResponse = await fetch(backendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id: sessionId,
            user_message: messageContent,
            user_id: backendMemberId,
            login_status: loginStatus,
            target_id: targetId,
            target_type: "user",
            file_attachment: fileAttachment,
          }),
          signal: AbortSignal.timeout(30000), // 30秒超时
        });

        if (!backendResponse.ok) {
          const errorData = await backendResponse.json().catch(() => ({}));
          const errorMessage = errorData.message || errorData.detail || "发送消息失败";
          console.error("[chat/route] User-to-user message failed:", errorData);
          return new ChatSDKError("offline:chat", errorMessage).toResponse();
        }

        const result = await backendResponse.json();
        const aiResponse = result.ai_response || result.response || "";

        // 用户-用户消息不需要AI回复，直接返回空响应
        // 消息已通过WebSocket实时推送，这里只需要返回成功状态
        // 返回一个简单的流式响应格式（AI SDK期望的格式）
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // 立即写入完成标记
        (async () => {
          try {
            // 如果有回复消息（如离线提示），发送它
            if (aiResponse) {
              await writer.write(encoder.encode(`0:"${aiResponse.replace(/"/g, '\\"')}"\n`));
            }
            // 发送完成标记
            await writer.write(encoder.encode(`d:{"finishReason":"stop"}\n`));
            await writer.close();
          } catch (error) {
            console.error("[chat/route] Error writing user-to-user response:", error);
            await writer.abort(error);
          }
        })();

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } catch (error) {
        console.error("[chat/route] User-to-user message error:", error);
        return new ChatSDKError(
          "offline:chat",
          error instanceof Error ? error.message : "发送消息时遇到问题。请检查您的网络连接并重试。"
        ).toResponse();
      }
    }

    // Agent消息：使用流式接口
    // 使用 JSON SSE 格式（AI SDK 5 的 DefaultChatTransport 期望的格式）
    try {
      const backendUrl = `${BACKEND_API_URL}/api/chat/stream?use_data_stream_protocol=false`;
      console.log("[chat/route] Agent message, using streaming API:", backendUrl);
      
      const backendResponse = await fetch(backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(backendRequestBody),
        // 添加超时控制（60秒）
        signal: AbortSignal.timeout(60000),
      });

      if (!backendResponse.ok) {
        let errorData: any;
        try {
          errorData = await backendResponse.json();
        } catch {
          const errorText = await backendResponse.text();
          console.error("[chat/route] Backend API error (non-JSON):", {
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            errorText,
            backendUrl: BACKEND_API_URL,
          });
          return new ChatSDKError(
            "offline:chat",
            `后端服务错误: ${backendResponse.status} ${backendResponse.statusText}`
          ).toResponse();
        }

        // 解析后端统一错误格式
        const errorCode = errorData.code || "offline:chat";
        const errorMessage = errorData.message || errorData.detail || "请求失败";
        
        console.error("Backend API error:", errorData);
        
        // 根据错误码返回对应的 ChatSDKError
        if (errorCode.startsWith("unauthorized:")) {
          return new ChatSDKError("unauthorized:chat", errorMessage).toResponse();
        } else if (errorCode.startsWith("forbidden:")) {
          return new ChatSDKError("forbidden:chat", errorMessage).toResponse();
        } else if (errorCode.startsWith("not_found:")) {
          return new ChatSDKError("not_found:chat", errorMessage).toResponse();
        } else if (errorCode.startsWith("rate_limit:")) {
          return new ChatSDKError("rate_limit:chat", errorMessage).toResponse();
        } else if (errorCode.startsWith("bad_request:")) {
          return new ChatSDKError("bad_request:api", errorMessage).toResponse();
        } else {
          return new ChatSDKError("offline:chat", errorMessage).toResponse();
        }
      }

      // 创建 TransformStream 来拦截和处理流式响应
      // 符合 AI SDK 最佳实践：在服务器端保存 assistant 消息
      // 参考: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot/message-persistence
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = backendResponse.body?.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      
      // 用于收集 assistant 消息内容
      let assistantMessageId: string | null = null;
      let assistantMessageParts: Array<{ type: string; text?: string; reasoning?: string }> = [];
      let messageTextBuffer = "";
      let pendingChunk = "";
      let messageSaved = false; // 跟踪消息是否已保存，避免重复保存
      
      // 异步处理流式响应
      (async () => {
        try {
          if (!reader) {
            writer.close();
            return;
          }
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // 流结束，检查是否有未保存的消息（兜底逻辑）
              // 只在 finish 事件未触发或保存失败时执行
              if (!messageSaved && assistantMessageId && messageTextBuffer.trim()) {
                // 保存 messageId 到局部变量，确保类型收窄
                const messageId = assistantMessageId;
                const trimmedText = messageTextBuffer.trim();
                
                try {
                  // 构建消息 parts
                  const finalParts: Array<{ type: string; text?: string; reasoning?: string }> = [];
                  
                  // 添加 reasoning parts
                  for (const part of assistantMessageParts) {
                    if (part.type === "reasoning") {
                      finalParts.push({
                        type: "reasoning",
                        reasoning: part.reasoning,
                      });
                    }
                  }
                  
                  // 添加文本内容
                  if (trimmedText) {
                    finalParts.push({
                      type: "text",
                      text: trimmedText,
                    });
                  }
                  
                  await saveMessages({
                    messages: [
                      {
                        chatId: id,
                        id: messageId, // 使用局部变量，类型已收窄为 string
                        role: "assistant",
                        parts: finalParts as any,
                        attachments: [],
                        createdAt: new Date(),
                      },
                    ],
                  });
                  messageSaved = true; // 标记为已保存
                  console.log(`[chat/route] ✅ Saved assistant message ${messageId} to database (stream end - fallback)`);
                } catch (error) {
                  console.error("[chat/route] Failed to save assistant message (stream end):", error);
                }
              }
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            const fullChunk = pendingChunk + chunk;
            const lines = fullChunk.split("\n");
            pendingChunk = lines.pop() || ""; // 保存不完整的行
            
            for (const line of lines) {
              if (!line.trim()) {
                await writer.write(encoder.encode(line + "\n"));
                continue;
              }
              
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                
                if (!data) {
                  await writer.write(encoder.encode(line + "\n"));
                  continue;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  
                  // 检测消息开始
                  if (parsed.type === "text-start" && parsed.id) {
                    assistantMessageId = parsed.id;
                    assistantMessageParts = [];
                    messageTextBuffer = "";
                  }
                  
                  // 收集文本内容
                  if (assistantMessageId && parsed.type === "text-delta" && parsed.delta) {
                    messageTextBuffer += parsed.delta;
                  }
                  
                  // 收集 reasoning 内容（JSON SSE 格式）
                  if (assistantMessageId && parsed.type === "message-annotations" && parsed.parts) {
                    for (const part of parsed.parts) {
                      if (part.type === "reasoning" && part.reasoning) {
                        assistantMessageParts.push({
                          type: "reasoning",
                          reasoning: part.reasoning,
                        });
                      }
                    }
                  }
                  
                  // 收集 reasoning 内容（Data Stream Protocol 格式）
                  if (assistantMessageId && parsed.type === "reasoning" && parsed.reasoning) {
                    assistantMessageParts.push({
                      type: "reasoning",
                      reasoning: parsed.reasoning,
                    });
                  }
                  
                  // 检测完成事件
                  if (parsed.type === "finish") {
                    // 流式响应完成，保存 assistant 消息到数据库
                    // 符合 AI SDK 最佳实践：确保所有必需字段存在后再保存
                    if (!messageSaved && assistantMessageId && messageTextBuffer.trim()) {
                      // 保存 messageId 到局部变量，确保类型收窄传递到 Promise 回调
                      const messageId = assistantMessageId;
                      const trimmedText = messageTextBuffer.trim();
                      
                      try {
                        // 构建消息 parts
                        const parts: Array<{ type: string; text?: string; reasoning?: string }> = [];
                        
                        // 添加 reasoning parts
                        for (const part of assistantMessageParts) {
                          if (part.type === "reasoning") {
                            parts.push({
                              type: "reasoning",
                              reasoning: part.reasoning,
                            });
                          }
                        }
                        
                        // 添加文本内容
                        if (trimmedText) {
                          parts.push({
                            type: "text",
                            text: trimmedText,
                          });
                        }
                        
                        // 立即保存消息（不阻塞流式响应）
                        // 符合 AI SDK 最佳实践：在服务器端保存消息
                        // 参考: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot/message-persistence
                        (async () => {
                          try {
                            await saveMessages({
                              messages: [
                                {
                                  chatId: id,
                                  id: messageId, // 使用局部变量，类型已收窄为 string
                                  role: "assistant",
                                  parts: parts as any,
                                  attachments: [],
                                  createdAt: new Date(),
                                },
                              ],
                            });
                            messageSaved = true; // 标记为已保存
                            console.log(`[chat/route] ✅ Saved assistant message ${messageId} to database`);
                          } catch (error) {
                            console.error("[chat/route] Failed to save assistant message:", error);
                            // 保存失败时，记录错误但不影响用户体验
                            // 流结束时会再次尝试保存（兜底逻辑）
                          }
                        })(); // 立即执行异步函数，不阻塞流式响应
                      } catch (error) {
                        console.error("[chat/route] Error saving assistant message:", error);
                      }
                    }
                    
                    // 重置状态
                    assistantMessageId = null;
                    assistantMessageParts = [];
                    messageTextBuffer = "";
                  }
                } catch {
                  // 忽略 JSON 解析错误（可能是其他格式的数据）
                }
              }
              
              // 转发原始数据
              await writer.write(encoder.encode(line + "\n"));
            }
          }
          
          // 处理剩余的 pending chunk
          if (pendingChunk) {
            await writer.write(encoder.encode(pendingChunk));
          }
        } catch (error) {
          console.error("[chat/route] Error processing stream:", error);
        } finally {
          writer.close();
        }
      })();
      
      // 返回转换后的流
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      console.error("[chat/route] Error proxying to backend:", {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : "Unknown",
        backendUrl: BACKEND_API_URL,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // 不要直接 throw，而是返回错误响应
      if (error instanceof ChatSDKError) {
        return error.toResponse();
      }
      
      // 处理网络错误（连接失败、超时等）
      if (error instanceof Error) {
        if (error.name === "AbortError" || error.message.includes("timeout")) {
          return new ChatSDKError(
            "offline:chat",
            "后端服务响应超时，请稍后重试"
          ).toResponse();
        }
        if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
          return new ChatSDKError(
            "offline:chat",
            `无法连接到后端服务 (${BACKEND_API_URL})，请检查服务是否运行`
          ).toResponse();
        }
        if (error.message?.includes("Backend API error")) {
          return new ChatSDKError("offline:chat", error.message).toResponse();
        }
      }
      
      // 其他错误也转换为 ChatSDKError
      return new ChatSDKError(
        "offline:chat",
        error instanceof Error ? error.message : "未知错误，请稍后重试"
      ).toResponse();
    }
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    // 后端 API 错误处理
    if (
      error instanceof Error &&
      error.message?.includes("Backend API error")
    ) {
      console.error("[chat/route] Backend API error (outer catch):", error);
      return new ChatSDKError("offline:chat", error.message).toResponse();
    }

    console.error("[chat/route] Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat", error instanceof Error ? error.message : "Unknown error").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
