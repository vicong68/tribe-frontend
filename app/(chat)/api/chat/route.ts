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
import { convertToUIMessages, generateUUID, getTextFromMessage, isValidUUID, fetchWithErrorHandlers } from "@/lib/utils";
import { generateTitleFromUserMessage, updateChatTitleAsync } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import { entityCache } from "@/lib/cache/entity-cache";
import { z } from "zod";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 从后端获取 Agent 或用户的显示名称（带缓存优化）
 * 仅在消息创建时调用一次，避免重复查询
 * 优化：
 * 1. 优先使用缓存，减少API调用
 * 2. 对于 Agent，如果 targetId 已经是显示名称，直接返回
 * 3. 批量获取列表时自动更新缓存
 */
async function getAgentOrUserName(
  targetId: string,
  isUser: boolean
): Promise<string | null> {
  // ✅ 优化：优先从缓存获取
  const cachedName = isUser
    ? entityCache.getUserName(targetId)
    : entityCache.getAgentName(targetId);
  
  if (cachedName) {
    return cachedName;
  }

  try {
    // 添加超时控制（5秒），避免阻塞消息创建流程
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      // 使用统一实体信息API（更高效）
      const response = await fetch(`${BACKEND_API_URL}/api/entity/summary?entity_type=${isUser ? "user" : "agent"}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        
        if (isUser) {
          // 用户：从后端用户列表获取（targetId 是 member_id）
          // 注意：必须大小写敏感匹配，不能使用toLowerCase/toUpperCase
          const users = data.users || [];
          
          // ✅ 优化：缓存整个用户列表
          entityCache.setUserList(users);
          
          const user = users.find(
            (item: any) => {
              // 精确匹配：user::member_id 或 member_id（大小写敏感）
              const itemId = item.id || "";
              const itemMemberId = itemId.replace(/^user::/, "");
              return itemId === `user::${targetId}` || 
                     itemId === targetId || 
                     itemMemberId === targetId;
            }
          );
          const displayName = user?.display_name || user?.nickname || null;
          
          // ✅ 优化：缓存单个用户名称
          if (displayName && targetId) {
            entityCache.setUserName(targetId, displayName);
          }
          
          return displayName;
        } else {
          // Agent：从后端 agent 列表获取（targetId 是 agent_id）
          const agents = data.agents || [];
          
          // ✅ 优化：缓存整个Agent列表
          entityCache.setAgentList(agents);
          
          const agent = agents.find(
            (item: any) => item.id === targetId
          );
          const displayName = agent?.display_name || targetId; // 如果找不到，使用 targetId 本身
          
          // ✅ 优化：缓存单个Agent名称
          if (displayName && targetId) {
            entityCache.setAgentName(targetId, displayName);
          }
          
          return displayName;
        }
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        // 超时时返回后备值，但不缓存
        return isUser ? null : targetId;
      }
      throw fetchError;
    }
  } catch (error) {
    // 错误时返回后备值，但不缓存
    return isUser ? null : targetId;
  }
  return null;
}

// 优化：根据 Vercel AI SDK 最佳实践，设置合理的超时时间
// 参考：https://sdk.vercel.ai/docs/guides/streaming
// 60秒适合长对话和复杂推理场景
export const maxDuration = 60;

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (error: unknown) {
    // 记录详细的验证错误信息，便于调试
    if (process.env.NODE_ENV === "development") {
      console.error("[Chat API] Schema validation error:", error);
      if (error instanceof z.ZodError) {
        console.error("[Chat API] Validation errors:", JSON.stringify(error.errors, null, 2));
      }
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
      
      // 缓存消息parts，避免重复提取
      const messageParts = message.parts || [];
      const hasFileAttachments = messageParts.some((part) => part.type === "file");
      const messageText = getTextFromMessage(message);
      
      // ✅ 优化：使用轻量级标题作为默认（快速、不阻塞）
      // 然后异步更新为 AI 生成的标题（备用方案）
      let title = "新对话";
      const backendMemberId = session.user.type === "guest" 
        ? "guest_user"
        : (session.user.memberId || session.user.email?.split("@")[0] || session.user.id);
      
      // 验证消息文本不为空（如果有文件附件但没有文本，也跳过标题生成）
      if (messageText && messageText.trim().length > 0) {
        try {
          // 1. 使用轻量级标题生成（快速、不阻塞主流程）
          title = await generateTitleFromUserMessage({
            message,
            userId: backendMemberId,
            lightweight: true, // 使用轻量级模式
          });
          
          console.log("[Chat API] 轻量级标题生成完成:", {
            chatId: id,
            title,
            messagePreview: messageText.substring(0, 50) + (messageText.length > 50 ? "..." : ""),
          });
          
          // 2. AI 标题生成逻辑保留但不再调用（备用，不阻塞当前流程）
        } catch (error) {
          console.error("[Chat API] ❌ 轻量级标题生成异常:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            chatId: id,
          });
          title = "新对话";
        }
      } else {
        console.log("[Chat API] 消息文本为空或仅有文件，跳过标题生成");
      }

      try {
        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      } catch (error) {
        // 静默处理错误，允许继续执行
      }
      // New chat - no need to fetch messages, it's empty
    }

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
      backendMemberId = session.user.id;
    }
    
    // 判断是用户-用户对话还是用户-Agent对话（用于构建metadata）
    // 注意：访客用户只能与 Agent 对话，不能与用户对话
    const isUserToUser = selectedChatModel.startsWith("user::");
    
    // 访客用户不能发送用户-用户消息
    if (isUserToUser && session.user.type === "guest") {
      console.error("[chat/route] Guest user attempted to send user-user message:", selectedChatModel);
      return new ChatSDKError(
        "forbidden:chat",
        "访客用户不能发送用户-用户消息"
      ).toResponse();
    }
    
    const targetId = isUserToUser 
      ? selectedChatModel.replace(/^user::/, "") 
      : selectedChatModel;
    
    // 在消息创建时获取收发方名称（仅查询一次，固化到metadata）
    // 用户消息的发送方名称：优先使用后端返回的昵称，否则使用memberId，最后使用email前缀
    // 注意：必须大小写敏感，不能从email提取（email可能大小写不一致）
    // 访客用户显示中文"访客"，登录用户显示memberId或email前缀
    let senderName = "我";
    if (session.user.type === "guest") {
      // 访客用户显示中文"访客"
      senderName = "访客";
    } else if (session.user.memberId) {
      // 优先使用memberId（后端标准ID）
      senderName = session.user.memberId;
    } else if (session.user.email) {
      // 如果memberId不存在，才从email提取（保持向后兼容）
      senderName = session.user.email.split("@")[0];
    }
    // 接收方名称：从后端获取（Agent 或用户）
    // 注意：必须确保 targetId 是正确的 agent_id 或 member_id
    // 如果 isUserToUser 为 false，targetId 应该是 agent_id（如 "chat", "rag"）
    // 如果 isUserToUser 为 true，targetId 应该是 member_id（不包含 "user::" 前缀）
    const receiverName = await getAgentOrUserName(targetId, isUserToUser);
    
    // 调试日志（仅在开发环境）
    if (process.env.NODE_ENV === "development") {
      console.log("[chat/route] Message metadata:", {
        selectedChatModel,
        targetId,
        isUserToUser,
        receiverName,
        backendMemberId,
        senderName,
      });
    }
    
    // 构建用户消息的metadata（固化名称和头像）
    const userMessageMetadata: Record<string, any> = {
      createdAt: new Date().toISOString(),
      senderId: backendMemberId,
      senderName: senderName, // 固化发送方名称
      communicationType: isUserToUser ? "user_user" : "user_agent",
    };
    
    if (isUserToUser) {
      userMessageMetadata.receiverId = targetId;
      userMessageMetadata.receiverName = receiverName || targetId; // 固化接收方名称
    } else {
      userMessageMetadata.receiverId = targetId; // Agent ID
      userMessageMetadata.agentUsed = targetId; // Agent ID（用于显示）
      // 如果 receiverName 为空或等于 targetId，说明查找失败，使用 targetId 作为后备
      // 但这种情况不应该发生，因为 getAgentOrUserName 会返回 targetId 作为后备
      userMessageMetadata.receiverName = receiverName || targetId; // 固化 Agent 名称
    }
    
    // 保存用户消息到数据库
    // 检查消息 ID 是否为有效的 UUID 格式
    let dbUserMessageId = message.id;
    if (!isValidUUID(message.id)) {
      // 生成新的 UUID 作为数据库 ID
      dbUserMessageId = generateUUID();
      userMessageMetadata.originalMessageId = message.id;
    }
    
    await saveMessages({
      messages: [
        {
          chatId: id,
          id: dbUserMessageId, // 使用有效的 UUID
          role: "user",
          parts: message.parts,
          attachments: [],
          metadata: userMessageMetadata,
          createdAt: new Date(),
        },
      ],
    });

    // 构建后端 API 请求体
    // 提取最后一条用户消息的内容（使用统一的工具函数）
    const messageContent = getTextFromMessage(message);
    
    // 提取文件附件信息（仅在需要时提取）
    // 从attachments中获取完整元数据（包含size和fileId）
    const messageParts = message.parts || [];
    const fileParts = messageParts.filter((part) => part.type === "file");
    
    // 从attachments中查找对应的文件信息（通过url匹配）
    let fileAttachment = undefined;
    if (fileParts.length > 0) {
      const filePart = fileParts[0] as any;
      
      // 提取文件信息，提供默认值增强容错性
      const fileUrl = filePart.url || "";
      const fileName = filePart.name || "file";
      const fileMediaType = filePart.mediaType || "application/octet-stream";
      const fileSize = filePart.size || 0;
      
      // 从URL或fileId中提取fileId（优先使用fileId字段）
      const fileId = filePart.fileId || filePart.url || fileUrl;
      
      // 验证必需字段
      if (!fileId && !fileUrl) {
        console.error("[chat/route] ⚠️  文件附件缺少 file_id 和 url，跳过文件处理");
      } else {
        // 构建符合后端ChatFileAttachment格式的对象
        fileAttachment = {
          filename: fileName, // 使用filename而非file_name
          size: fileSize, // 添加size字段，如果缺失则使用0（后端会从文件系统获取）
          file_type: fileMediaType,
          file_id: fileId || fileUrl, // 如果fileId为空，使用url
          download_url: fileUrl || fileId, // 如果url为空，使用fileId
        };
      }
    }

    // 构建历史消息（转换为后端格式）
    // 仅在存在历史消息时进行转换（避免不必要的操作）
    const historyMessages = messagesFromDb.length > 0
      ? convertToUIMessages(messagesFromDb).map((msg) => ({
          role: msg.role,
          content: getTextFromMessage(msg),
          // 保留历史消息的 metadata，方便后端在流式响应中透传（如 agent 路由信息）
          metadata: msg.metadata,
        }))
      : [];

    // 添加当前用户消息（包含parts信息，用于文件附件）
    const allMessages = [
      ...historyMessages,
      {
        role: "user" as const,
        content: messageContent,
        // 将前端生成的 metadata 一并传给后端，便于在流式响应中透传（包括 agent/id 路由信息）
        metadata: userMessageMetadata,
        // 包含parts信息（用于文件附件，后端会从parts中提取文件信息）
        parts: message.parts,
      },
    ];

    // 构建后端请求体（符合 AI SDK 格式）
    // 根据用户类型确定登录状态
    const loginStatus = session.user.type === "guest" ? "未登录" : "已登录";
    
    // 使用之前定义的 isUserToUser 和 targetId
    const targetType = isUserToUser ? "user" : "agent";
    
    // 生成统一的 session_id（确保对话记忆隔离，双方顺序一致）
    // 格式：session_{participant1}_{participant2}，按字母序排序
    // 注意：使用后端 member_id 而不是前端 UUID，确保对话记忆一致性
    const sessionId = generateSessionId(backendMemberId, selectedChatModel);
    
    // 预生成 assistant 消息 ID（使用与 useChat 相同的 generateUUID）
    // 这样后端可以使用这个 ID，确保 text-start 和 data-appendMessage 中的 ID 与前端匹配
    const expectedAssistantMessageId = generateUUID();
    
    // 构建后端请求体
    const backendRequestBody: any = {
      messages: allMessages,
      member_id: backendMemberId, // 使用后端用户 ID
      conversation_id: sessionId, // 使用统一的 session_id 格式（用于对话记忆）
      chat_id: id, // ✅ 传递真实的 Chat 表 UUID（用于消息持久化）
      login_status: loginStatus, // 从 session 获取实际登录状态
      stream: true,
      use_knowledge_base: false,
      knowledge_file_ids: undefined,
      context_ids: undefined,
      expected_assistant_message_id: expectedAssistantMessageId, // 传递期望的 assistant 消息 ID
    };
    
    // 根据目标类型设置不同的字段
    if (isUserToUser) {
      // 用户-用户对话：使用 target_id 和 target_type
      backendRequestBody.target_id = targetId;
      backendRequestBody.target_type = "user";
    } else {
      // 用户-Agent对话：使用 agent_id（标准化：统一使用 agent_id，如 "chat", "rag"）
      backendRequestBody.agent_id = targetId; // Agent ID（标准化标识，如 "chat", "rag", "Info_Hunter"）
      backendRequestBody.target_type = "agent";
    }

    // 用户-用户消息使用非流式接口，Agent消息使用流式接口
    if (isUserToUser) {
      try {
        const backendUrl = `${BACKEND_API_URL}/api/chat?async_mode=false`;
        
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
        return new ChatSDKError(
          "offline:chat",
          error instanceof Error ? error.message : "发送消息时遇到问题。请检查您的网络连接并重试。"
        ).toResponse();
      }
    }

    try {
      const backendUrl = `${BACKEND_API_URL}/api/chat/stream?use_data_stream_protocol=false`;
      
      // 流式请求不使用超时，因为流式响应可能需要较长时间
      // 超时控制由后端和客户端处理
      // ✅ 优化：使用带重试机制的fetch（指数退避：1s, 2s, 4s, 8s，最大3次）
      let backendResponse: Response;
      try {
        backendResponse = await fetchWithErrorHandlers(
          backendUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(backendRequestBody),
          },
          {
            maxRetries: 3,
            retryDelay: 1000,
            retryableStatuses: [408, 429, 500, 502, 503, 504],
          }
        );
      } catch (fetchError) {
        // 如果是 ChatSDKError，直接返回
        if (fetchError instanceof ChatSDKError) {
          return fetchError.toResponse();
        }
        
        // 其他错误转换为 ChatSDKError
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        return new ChatSDKError("offline:chat", `后端请求失败: ${errorMessage}`).toResponse();
      }

      // ✅ 修复：fetchWithErrorHandlers 已经处理了错误，这里应该不会到达
      // 但如果到达这里且响应不ok，说明是重试后仍然失败的情况
      if (!backendResponse.ok) {
        let errorData: any;
        try {
          const contentType = backendResponse.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            errorData = await backendResponse.json();
          } else {
            const errorText = await backendResponse.text();
            errorData = { 
              message: errorText || `${backendResponse.status} ${backendResponse.statusText}`,
              detail: `后端返回非JSON响应: ${backendResponse.status} ${backendResponse.statusText}`
            };
          }
        } catch (parseError) {
          // 如果解析失败，使用状态码和状态文本
          return new ChatSDKError(
            "offline:chat",
            `后端服务错误: ${backendResponse.status} ${backendResponse.statusText}`
          ).toResponse();
        }

        const errorCode = errorData.code || "offline:chat";
        const errorMessage = errorData.message || errorData.detail || "请求失败";
        
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
      let pendingChunk = "";
      
      // 异步处理流式响应：直接转发后端流
      // 注意：用户消息由 useChat 自动管理，不需要通过 data-appendMessage 发送
      (async () => {
        try {
          if (!reader) {
            writer.close();
            return;
          }
          
          // 转发后端流：直接转发原始 SSE 事件，确保跨 chunk 事件完整性
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const fullChunk = pendingChunk + chunk;
            const lastNewlineIndex = fullChunk.lastIndexOf("\n\n");
            
            if (lastNewlineIndex >= 0) {
              const completePart = fullChunk.substring(0, lastNewlineIndex + 2);
              pendingChunk = fullChunk.substring(lastNewlineIndex + 2);
              await writer.write(encoder.encode(completePart));
            } else {
              pendingChunk = fullChunk;
            }
          }
        } catch (error) {
          // 静默处理错误，不影响流式响应
        } finally {
          // ✅ 修复：安全关闭 writer，避免重复关闭已关闭的流
          try {
            // 检查 writer 是否仍然有效（desiredSize 为 null 表示流已关闭）
            if (writer && writer.desiredSize !== null) {
              await writer.close();
            }
          } catch (closeError) {
            // 流可能已经关闭或出现其他错误，静默处理
            // 这不会影响主流程，因为流可能已经被其他地方关闭
          }
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
      if (error instanceof Error && error.message?.includes("Backend API error")) {
        return new ChatSDKError("offline:chat", error.message).toResponse();
      }
      
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

    if (
      error instanceof Error &&
      error.message?.includes("Backend API error")
    ) {
      return new ChatSDKError("offline:chat", error.message).toResponse();
    }

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
