"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useConversationManager } from "@/hooks/use-conversation-manager";
import { useMessagePersistence } from "@/hooks/use-message-persistence";
import { useOfflineMessages } from "@/hooks/use-offline-messages";
import { useStreamChatWithRetry } from "@/hooks/use-stream-chat-with-retry";
import { useChatModels } from "@/lib/ai/models-client";
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage, MessageMetadata } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { getBackendMemberId } from "@/lib/user-utils";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";
import { useSSEMessageContext } from "./websocket-message-provider";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
}) {
  const router = useRouter();

  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();

  // 使用 ref 存储预生成的 assistant 消息 ID
  // 这样 generateId 可以使用预生成的 ID，而不是每次都生成新的
  const expectedAssistantMessageIdRef = useRef<string | null>(null);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // When user navigates back/forward, refresh to sync with URL
      router.refresh();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router]);
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  
  // 会话管理器
  const conversationManager = useConversationManager(id);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const {
    messages,
    setMessages,
    sendMessage: originalSendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    isRetrying,
  } = useStreamChatWithRetry<ChatMessage>({
    id,
    messages: initialMessages,
    // 流式配置：固定 throttle 50ms，与后端基础配置匹配
    experimental_throttle: 50,
    generateId: () => {
      // 为前端新增消息生成独立的 UUID（用户与助手各自唯一）
      // 不再复用 expectedAssistantMessageIdRef，避免用户消息占用助手预期 ID
      return generateUUID();
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        expectedAssistantMessageIdRef.current = generateUUID();
        const assistantMessageId = expectedAssistantMessageIdRef.current;
        
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            expected_assistant_message_id: assistantMessageId,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart: any) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === "data-usage") {
        setUsage(dataPart.data);
      }
      
      // ✅ 处理后端保存成功通知：直接使用 data-persisted 事件中的完整消息信息更新消息对象
      // 优化方案：后端已在 data-persisted 事件中包含完整的 parts、content 和 metadata
      // 避免额外的 HTTP 请求，提升性能和用户体验
      // 参考 Vercel AI Chatbot 最佳实践：在流式响应中直接传递完整信息
      if (dataPart.type === "data-persisted" && dataPart.data?.persisted === true) {
        const messageId = dataPart.data?.messageId || messagesRef.current[messagesRef.current.length - 1]?.id;
        const persistedData = dataPart.data;
        
        if (messageId && persistedData) {
          backendPersistedMessageIdsRef.current.add(messageId);
          if (process.env.NODE_ENV === "development") {
            console.log(`[Chat] ✅ 后端已保存: ${messageId.slice(0, 8)}...`, {
              hasParts: !!persistedData.parts,
              hasContent: !!persistedData.content,
              hasMetadata: !!persistedData.metadata,
            });
          }
          
          // ✅ 直接使用 data-persisted 事件中的数据更新消息对象
          // 确保工具栏功能（复制/收藏/分享/点赞/点踩）和时间戳显示正常
          setMessages((prev) => {
            const messageIndex = prev.findIndex((msg) => msg.id === messageId);
            if (messageIndex === -1) {
              if (process.env.NODE_ENV === "development") {
                console.warn(`[Chat] 消息 ${messageId.slice(0, 8)}... 不在当前消息列表中，跳过更新`);
              }
              return prev;
            }
            
            const updated = [...prev];
            const currentMessage = prev[messageIndex];
            
            // ✅ 更新 parts（完整内容，包含 reasoning、tool、file 等）
            // 优先使用 data-persisted 事件中的 parts，回退到当前消息的 parts
            const finalParts = (persistedData.parts && Array.isArray(persistedData.parts) && persistedData.parts.length > 0)
              ? persistedData.parts
              : (currentMessage.parts && currentMessage.parts.length > 0 ? currentMessage.parts : []);
            
            // ✅ 更新 content（AI SDK 标准字段，确保 getTextFromMessage 能正确提取）
            // 优先使用 data-persisted 事件中的 content，其次从 parts 提取，最后保留当前消息的 content
            let finalContent = persistedData.content;
            if (!finalContent && finalParts.length > 0) {
              // 从 parts 提取文本内容作为 content
              const textParts = finalParts.filter((p: any) => p?.type === "text");
              if (textParts.length > 0) {
                finalContent = textParts.map((p: any) => p.text || "").join("");
              }
            }
            if (!finalContent) {
              finalContent = (currentMessage as any).content;
            }
            
            // ✅ 更新 metadata（包含完整的 createdAt、senderName、agentUsed 等）
            const finalMetadata = {
              ...currentMessage.metadata,
              ...persistedData.metadata,
              createdAt: persistedData.metadata?.createdAt || 
                        currentMessage.metadata?.createdAt ||
                        new Date().toISOString(),
            };
            
            // ✅ 构建更新后的消息对象
            updated[messageIndex] = {
              ...currentMessage,
              parts: finalParts,
              ...(finalContent ? { content: finalContent } : {}),
              metadata: finalMetadata,
            };
            
            if (process.env.NODE_ENV === "development") {
              console.log(`[Chat] ✅ 消息已更新: ${messageId.slice(0, 8)}...`, {
                partsCount: finalParts.length,
                hasContent: !!finalContent,
                createdAt: finalMetadata.createdAt,
              });
            }
            
            return updated;
          });
        }
      }
      
      // ✅ 优化：处理后端发送的 metadata 事件，确保在流式传输过程中正确更新消息的 metadata
      // 后端在流式响应开始时通过 metadata 事件传递 agentUsed 和 senderName
      // AI SDK 会自动将 metadata 事件更新到消息中，但我们需要确保消息能正确渲染
      if (dataPart.type === "metadata" || (dataPart.type === "data" && dataPart.data?.type === "metadata")) {
        const metadata = dataPart.type === "metadata" ? dataPart : dataPart.data;
        if (metadata && typeof metadata === "object") {
          // metadata 事件已由 AI SDK 自动处理，这里只需要记录日志（开发环境）
          if (process.env.NODE_ENV === "development") {
            console.log(`[Chat] 📝 收到 metadata 事件:`, {
              agentUsed: metadata.agentUsed,
              senderName: metadata.senderName,
              communicationType: metadata.communicationType,
            });
          }
        }
      }
      
      // 用户-用户消息不需要流式状态（消息已通过SSE实时推送）
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      const isUserToUser = lastMessage?.metadata?.communicationType === "user_user";
      
      if (!isUserToUser) {
        conversationManager.updateStatus("streaming");
      }
    },
    onFinish: () => {
      // ✅ AI SDK 最佳实践：metadata 已由 AI SDK 自动合并到消息对象
      // 后端通过 metadata 事件发送完整 metadata，AI SDK 自动处理，无需前端额外逻辑
      // 前端可以直接使用 message.metadata 访问完整的 metadata（createdAt、senderName、agentUsed 等）
      
      // 流式响应完成：标记状态为 idle
      // 消息保存通过后端处理，metadata 已由 AI SDK 自动处理
      startTransition(() => {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
      });
      conversationManager.updateStatus("idle");
    },
    onError: (error) => {
      // 更新对话状态为 idle（错误时）
      conversationManager.updateStatus("idle");
      
      // 根据错误类型提供更友好的错误提示
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
        });
      } else if (error instanceof Error) {
        // 网络错误或未知错误
        const errorMessage = error.message || "发生未知错误";
        const isNetworkError = 
          errorMessage.includes("network") ||
          errorMessage.includes("fetch") ||
          errorMessage.includes("offline") ||
          errorMessage.includes("Failed to fetch");
        
        toast({
          type: "error",
          description: isNetworkError 
            ? "网络连接失败，请检查网络后重试" 
            : `错误：${errorMessage}`,
        });
      } else {
        toast({
          type: "error",
          description: "发生未知错误，请稍后重试",
        });
      }
    },
  });

  const { saveAssistantMessages } = useMessagePersistence({
    chatId: id,
    messages,
  });

  // 保存 saveAssistantMessages 到 ref，以便在 onFinish 中使用（避免闭包问题）
  const saveAssistantMessagesRef = useRef(saveAssistantMessages);
  useEffect(() => {
    saveAssistantMessagesRef.current = saveAssistantMessages;
  }, [saveAssistantMessages]);

  // ✅ 消息保存策略：优先使用后端保存，前端保存作为备用（默认禁用）
  const backendPersistedMessageIdsRef = useRef<Set<string>>(new Set());
  const ENABLE_FRONTEND_SAVE = false; // 设置为 true 可启用前端保存（调试用）
  
  // ✅ AI SDK 最佳实践：使用原生 metadata 事件
  // 后端通过 metadata 事件发送完整 metadata（流式开始时发送基础信息，结束时补充 createdAt）
  // AI SDK 会自动将 metadata 合并到消息对象，前端无需缓存和应用逻辑
  
  // ⚠️ 消息固化函数（保留作为兜底机制）
  // 优化方案：现在优先使用 data-persisted 事件中的完整信息直接更新消息对象
  // 此函数保留用于兜底场景（例如 data-persisted 事件处理失败时的降级处理）
  // 正常情况下不再调用，因为 data-persisted 事件已包含完整的 parts、content 和 metadata
  const solidifyMessage = useCallback(async (messageId: string) => {
    try {
      // 从数据库获取完整消息（包含完整的 parts、metadata 等）
      const response = await fetch(`/api/messages?chatId=${encodeURIComponent(id)}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[Chat] 获取消息失败 (${response.status})，跳过固化`);
        }
        return;
      }

      const messagesFromDb = await response.json();
      if (!Array.isArray(messagesFromDb)) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[Chat] 消息数据格式错误，跳过固化");
        }
        return;
      }

      // 找到刚保存的消息
      const solidifiedMessage = messagesFromDb.find((msg: ChatMessage) => msg.id === messageId);
      if (!solidifiedMessage) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[Chat] 未找到消息 ${messageId.slice(0, 8)}...，跳过固化`);
        }
        return;
      }

      // 更新消息对象：使用数据库中的完整消息内容
      // 关键：更新 parts 和 content，确保工具栏功能正常
      setMessages((prevMessages) => {
        const messageIndex = prevMessages.findIndex((msg) => msg.id === messageId);
        if (messageIndex === -1) {
          if (process.env.NODE_ENV === "development") {
            console.warn(`[Chat] 消息 ${messageId.slice(0, 8)}... 不在当前消息列表中，跳过固化`);
          }
          return prevMessages;
        }

        const updated = [...prevMessages];
        const currentMessage = prevMessages[messageIndex];
        
        // ✅ 关键修复：使用数据库中的完整 parts（确保内容完整）
        // 优先使用数据库中的 parts（已保存的完整内容），回退到当前消息的 parts
        const finalParts = solidifiedMessage.parts && solidifiedMessage.parts.length > 0
          ? solidifiedMessage.parts
          : currentMessage.parts;
        
        // ✅ 从 parts 提取完整文本内容作为 content（AI SDK 标准字段）
        // 确保 getTextFromMessage 能正确提取内容
        const textParts = finalParts.filter((p: any) => p?.type === "text");
        const extractedContent = textParts.length > 0
          ? textParts.map((p: any) => p.text || "").join("")
          : undefined;
        
        // 优先使用数据库消息的 content，其次使用提取的内容，最后保留当前消息的 content
        const finalContent = (solidifiedMessage as any).content || 
                            extractedContent ||
                            (currentMessage as any).content;

        updated[messageIndex] = {
          ...currentMessage,
          // ✅ 更新 parts（完整内容）
          parts: finalParts,
          // ✅ 更新 content（AI SDK 标准字段，确保 getTextFromMessage 能正确提取）
          ...(finalContent ? { content: finalContent } : {}),
          // ✅ 更新 metadata（包含完整的 createdAt、senderName、agentUsed 等）
          metadata: {
            ...currentMessage.metadata,
            ...solidifiedMessage.metadata,
            createdAt: solidifiedMessage.metadata?.createdAt || 
                      currentMessage.metadata?.createdAt ||
                      new Date().toISOString(),
          },
        };

        if (process.env.NODE_ENV === "development") {
          console.log(`[Chat] ✅ 消息已固化: ${messageId.slice(0, 8)}...`, {
            partsCount: finalParts.length,
            hasContent: !!finalContent,
            createdAt: updated[messageIndex].metadata?.createdAt,
          });
        }

        return updated;
      });
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[Chat] 消息固化失败:", error);
      }
    }
  }, [id, setMessages]);

  // 获取 SSE 消息上下文（用于接收用户-用户消息）
  const { onMessage: onSSEMessage, isConnected: sseConnected } = useSSEMessageContext();
  
  // 获取用户 ID 和登录状态（用于拉取离线消息）
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular"; // 只有登录用户才拉取离线消息
  const userId = isLoggedIn && session?.user
    ? getBackendMemberId(session.user)
    : null;

  // 统一供渲染使用的模型映射（含静态/动态 agent）
  const { models: chatModels } = useChatModels(false);
  const modelLookup = useMemo(() => {
    const lookup: Record<string, { name?: string }> = {};
    for (const model of chatModels) {
      lookup[model.id] = { name: model.name };
    }
    return lookup;
  }, [chatModels]);

  // 拉取离线消息（仅在用户登录成功且 SSE 连接建立后）
  // 拉取完成后触发用户列表和状态更新
  useOfflineMessages({
    userId,
    isLoggedIn,
    isConnected: sseConnected,
    onMessages: useCallback((offlineMessages: ChatMessage[]) => {
      if (offlineMessages.length === 0) {
        return;
      }
      
      // 将离线消息添加到消息列表
      setMessages((prevMessages) => {
        const existingIds = new Set(prevMessages.map(m => m.id));
        const newMessages = offlineMessages.filter(msg => !existingIds.has(msg.id));
        
        if (newMessages.length === 0) {
          return prevMessages;
        }
        
        // 检查是否已存在相同内容的消息（避免重复），同时比较文本与文件
        const uniqueNewMessages = newMessages.filter((newMsg) => {
          const newTextPart = newMsg.parts?.find((p: any) => p.type === "text") as any;
          const newFilePart = newMsg.parts?.find((p: any) => p.type === "file") as any;
          const newText = newTextPart?.text || "";
          const newFileUrl = newFilePart?.url || null;

          return !prevMessages.some((existing) => {
            const existingTextPart = existing.parts?.find((p: any) => p.type === "text") as any;
            const existingFilePart = existing.parts?.find((p: any) => p.type === "file") as any;
            const existingText = existingTextPart?.text || "";
            const existingFileUrl = existingFilePart?.url || null;

            const textMatch = (!existingText && !newText) || existingText === newText;
            const fileMatch = (!existingFileUrl && !newFileUrl) || existingFileUrl === newFileUrl;

            return (
              existing.metadata?.senderId === newMsg.metadata?.senderId &&
              existing.metadata?.receiverId === newMsg.metadata?.receiverId &&
              existing.role === "assistant" &&
              existing.metadata?.communicationType === "user_user" &&
              textMatch &&
              fileMatch
            );
          });
        });
        
        if (uniqueNewMessages.length === 0) {
          return prevMessages;
        }
        
        // 仅对非用户-用户消息执行前端保存；用户-用户消息已由后端持久化
        const messagesToPersist = uniqueNewMessages.filter(
          (msg) => msg.metadata?.communicationType !== "user_user"
        );
        if (messagesToPersist.length > 0) {
          saveAssistantMessages(messagesToPersist).catch((error) => {
            console.error("[Chat] Failed to save offline messages to database:", error);
          });
        }
        
        return [...prevMessages, ...uniqueNewMessages];
      });
    }, [setMessages, saveAssistantMessages]),
    onOfflineMessagesFetched: useCallback(() => {
      // ✅ 性能优化：离线消息拉取完成后，使用 SWR 的 mutate 清除缓存
      // 注意：这里使用动态导入避免循环依赖，但实际清除需要通过 useSWRConfig
      // 由于这是回调函数，无法直接使用 hook，所以这里只做标记
      // 实际的缓存清除由其他组件（如 friends-list）通过 refreshKey 触发
      if (process.env.NODE_ENV === "development") {
        console.log("[Chat] Offline messages fetched, cache should be refreshed");
      }
    }, []),
  });

  // 更新 messagesRef 以跟踪最新的消息列表
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ✅ AI SDK 最佳实践：消息固化标准流程已实现
  // 1. 后端在流式开始时通过 metadata 事件发送基础 metadata（agentUsed、senderName 等）
  // 2. 后端在流式结束时通过 metadata 事件发送完整 metadata（包含 createdAt）
  // 3. AI SDK 自动将 metadata 合并到消息对象
  // 4. 前端直接使用 message.metadata 访问完整 metadata，无需额外处理
  // 这样确保消息在流式渲染结束后立即有完整的 metadata（createdAt、senderName、agentUsed 等），且符合 AI SDK 最佳实践

  // ✅ 流式响应完成后的保存逻辑（默认禁用，优先使用后端保存）
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const isStatusChanged = prevStatusRef.current === "streaming" && status !== "streaming";
    prevStatusRef.current = status;
    
    if (!isStatusChanged || !ENABLE_FRONTEND_SAVE) {
      return; // 前端保存已禁用
    }

    // 仅在前端保存启用时执行（调试模式）
    const unsavedMessages = messages
      .filter((msg) => msg.role === "assistant" && !backendPersistedMessageIdsRef.current.has(msg.id));
    
    if (unsavedMessages.length > 0) {
      console.warn(`[Chat] ⚠️  前端保存（调试模式）: ${unsavedMessages.length} 条消息`);
      setTimeout(() => {
        saveAssistantMessagesRef.current(unsavedMessages).catch((error) => {
          console.error("[Chat] 前端保存失败:", error);
        });
      }, 100);
    }
  }, [status, messages]);

  // 处理 SSE 中的用户-用户消息
  useEffect(() => {
    const unsubscribe = onSSEMessage((sseMessage) => {
      // 只处理用户-用户消息
      if (sseMessage.communication_type !== "user_user") {
        return;
      }

      // 检查消息是否已经存在（避免重复添加）
      // 改进：同时检查文本内容和文件附件，确保正确去重
      const existingMessage = messages.find((msg) => {
        // 检查基本字段匹配
        if (
          msg.metadata?.senderId !== sseMessage.sender_id ||
          msg.metadata?.receiverId !== sseMessage.receiver_id ||
          msg.role !== "assistant" ||
          msg.metadata?.communicationType !== "user_user"
        ) {
          return false;
        }
        
        // 提取消息的文本和文件信息
        const msgParts = msg.parts || [];
        const msgTextParts = msgParts.filter((p: any) => p.type === "text");
        const msgFileParts = msgParts.filter((p: any) => p.type === "file");
        const msgText = msgTextParts.length > 0 ? (msgTextParts[0] as any).text : "";
        const msgFileUrl = msgFileParts.length > 0 ? (msgFileParts[0] as any).url : null;
        
        // 提取SSE消息的文本和文件信息
        const sseText = sseMessage.content && sseMessage.content !== "[FILE_TRANSFER]" 
          ? sseMessage.content 
          : "";
        const sseFileUrl = sseMessage.file_attachment 
          ? (sseMessage.file_attachment.download_url || sseMessage.file_attachment.file_id)
          : null;
        
        // 比较文本内容（忽略空文本）
        const textMatch = !msgText && !sseText || msgText === sseText;
        
        // 比较文件URL（如果有文件）
        const fileMatch = !msgFileUrl && !sseFileUrl || msgFileUrl === sseFileUrl;
        
        // 只有当文本和文件都匹配时，才认为是同一条消息
        return textMatch && fileMatch;
      });

      if (existingMessage) {
        console.log("[Chat] 检测到重复消息，已跳过:", {
          senderId: sseMessage.sender_id,
          receiverId: sseMessage.receiver_id,
          content: sseMessage.content,
          hasFile: !!sseMessage.file_attachment,
        });
        return;
      }

      // 将 SSE 消息转换为 ChatMessage 格式
      const parts: any[] = [];
      
      // 添加文件附件（如果有）
      if (sseMessage.file_attachment) {
        const fileAttachment = sseMessage.file_attachment;
        // ✅ 完整映射文件附件字段，支持多种字段名（向后兼容）
        const filePart: any = {
          type: "file" as const,
          // URL：优先使用 download_url，其次使用 file_id 构建 URL
          url: fileAttachment.download_url || 
               (fileAttachment.file_id ? `/api/files/download/${fileAttachment.file_id}` : "") ||
               fileAttachment.url || "",
          // ✅ 文件名：优先使用 filename（后端标准字段），其次使用 file_name（兼容字段）
          name: fileAttachment.filename || 
                fileAttachment.file_name || 
                fileAttachment.name || 
                "file",
          // ✅ MIME 类型
          mediaType: fileAttachment.file_type || 
                     fileAttachment.mediaType || 
                     fileAttachment.contentType || 
                     "application/octet-stream",
        };
        
        // ✅ 文件大小（可选）
        if (fileAttachment.size !== undefined && fileAttachment.size !== null) {
          filePart.size = fileAttachment.size;
        }
        
        // ✅ 文件ID（可选，用于下载）
        if (fileAttachment.file_id) {
          filePart.fileId = fileAttachment.file_id;
        }
        
        // ✅ 缩略图URL（可选，仅图片文件）
        if (fileAttachment.thumbnail_url || fileAttachment.thumbnailUrl) {
          filePart.thumbnailUrl = fileAttachment.thumbnail_url || fileAttachment.thumbnailUrl;
        }
        
        parts.push(filePart);
      }
      
      // 添加文本内容（如果有）
      if (sseMessage.content && sseMessage.content !== "[FILE_TRANSFER]") {
        parts.push({
          type: "text" as const,
          text: sseMessage.content,
        });
      }
      
      const chatMessage: ChatMessage = {
        id: generateUUID(),
        role: "assistant",
        parts,
        metadata: {
          createdAt: sseMessage.created_at || new Date().toISOString(),
          senderId: sseMessage.sender_id,
          senderName: sseMessage.sender_name,
          receiverId: sseMessage.receiver_id,
          receiverName: sseMessage.receiver_name,
          communicationType: "user_user",
        },
      };

      // 添加到消息列表
      setMessages((prevMessages) => {
        // 检查是否已存在（再次检查，避免重复）
        // 改进：同时检查文本内容和文件附件
        const alreadyExists = prevMessages.some((msg) => {
          // 检查基本字段匹配
          if (
            msg.metadata?.senderId !== chatMessage.metadata?.senderId ||
            msg.metadata?.receiverId !== chatMessage.metadata?.receiverId ||
            msg.role !== "assistant" ||
            msg.metadata?.communicationType !== "user_user"
          ) {
            return false;
          }
          
          // 提取消息的文本和文件信息
          const msgParts = msg.parts || [];
          const msgTextParts = msgParts.filter((p: any) => p.type === "text");
          const msgFileParts = msgParts.filter((p: any) => p.type === "file");
          const msgText = msgTextParts.length > 0 ? (msgTextParts[0] as any).text : "";
          const msgFileUrl = msgFileParts.length > 0 ? (msgFileParts[0] as any).url : null;
          
          // 提取新消息的文本和文件信息
          const newParts = chatMessage.parts || [];
          const newTextParts = newParts.filter((p: any) => p.type === "text");
          const newFileParts = newParts.filter((p: any) => p.type === "file");
          const newText = newTextParts.length > 0 ? (newTextParts[0] as any).text : "";
          const newFileUrl = newFileParts.length > 0 ? (newFileParts[0] as any).url : null;
          
          // 比较文本内容（忽略空文本）
          const textMatch = !msgText && !newText || msgText === newText;
          
          // 比较文件URL（如果有文件）
          const fileMatch = !msgFileUrl && !newFileUrl || msgFileUrl === newFileUrl;
          
          // 只有当文本和文件都匹配时，才认为是同一条消息
          return textMatch && fileMatch;
        });

        if (alreadyExists) {
          console.log("[Chat] 在setMessages中检测到重复消息，已跳过");
          return prevMessages;
        }

        return [...prevMessages, chatMessage];
      });

      // ✅ 关键修复：用户-用户消息（包括远端用户消息）也需要保存到数据库
      // 远端用户消息：role === "assistant" && communicationType === "user_user"
      // 这些消息必须保存，否则刷新后会丢失
      if (chatMessage.role === "assistant") {
        saveAssistantMessages([chatMessage]).catch((error) => {
          console.error("[Chat] Failed to save SSE message to database:", error);
        });
      }
    });

    return unsubscribe;
  }, [onSSEMessage, messages, setMessages, saveAssistantMessages]);


  // 处理 data-appendMessage 事件：仅更新 assistant 消息的 metadata
  // 注意：用户消息由 useChat 自动管理，不需要通过 data-appendMessage 处理
  // Assistant 消息的内容由 AI SDK 通过流式响应自动更新，这里只更新 metadata
  const { dataStream } = useDataStream();
  const processedMetadataRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (!dataStream?.length) return;
    const appendEvents = dataStream.filter((part) => part.type === "data-appendMessage");
    if (!appendEvents.length) return;

    appendEvents.forEach((dataPart) => {
      try {
        const messageWithMetadata: ChatMessage = typeof dataPart.data === "string"
          ? JSON.parse(dataPart.data)
          : dataPart.data;
        
        // 只处理 assistant 消息的 metadata 更新
        if (messageWithMetadata.role !== "assistant") {
          return;
        }
        
        const eventKey = `${messageWithMetadata.id}-metadata`;
        if (processedMetadataRef.current.has(eventKey)) {
          return;
        }
        
        setMessages((prev) => {
          const targetIndex = prev.findIndex(m => m.id === messageWithMetadata.id);
          
          if (targetIndex >= 0) {
            // 只更新 metadata，不更新 parts（由 AI SDK 管理）
            // 注意：完整的 metadata（包括 createdAt）由 AI SDK metadata 事件自动处理，这里只做基本合并
            const updated = [...prev];
            updated[targetIndex] = {
              ...prev[targetIndex],
                metadata: {
                  ...prev[targetIndex].metadata,
                  ...messageWithMetadata.metadata,
                  // 保留原有的 createdAt（如果有），否则使用消息中的 createdAt
                  // AI SDK metadata 事件会自动处理完整的 metadata（包含准确的 createdAt）
                  createdAt: prev[targetIndex].metadata?.createdAt || 
                             messageWithMetadata.metadata?.createdAt ||
                             new Date().toISOString(),
                },
            };
            processedMetadataRef.current.add(eventKey);
            return updated;
          }
          
          // 如果消息不存在，忽略（消息应该由 AI SDK 自动创建）
          return prev;
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("[Chat] Failed to process data-appendMessage:", error);
        }
      }
    });
  }, [dataStream, setMessages]);

  // 直接使用原始 sendMessage，固化逻辑已在 prepareSendMessagesRequest 中处理
  const sendMessage = originalSendMessage;

  useEffect(() => {
    const isSwitching = conversationManager.detectAgentSwitch(currentModelId);
    if (isSwitching && status === "streaming") {
      stop();
    }
  }, [currentModelId, conversationManager, status, stop]);

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
    chatId: id,
    currentAgentId: currentModelId,
    conversationManager,
  });

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
        />

        <Messages
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          modelLookup={modelLookup}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={currentModelId}
          sendMessage={sendMessage}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {/* 重试状态提示 */}
          {isRetrying && (
            <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
              <div className="size-2 animate-pulse rounded-full bg-yellow-500" />
              <span>正在重试发送消息...</span>
            </div>
          )}
          
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              input={input}
              messages={messages}
              onModelChange={setCurrentModelId}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              usage={usage}
            />
          )}
        </div>
      </div>

      <Artifact
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        modelLookup={modelLookup}
        messages={messages}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        votes={votes}
      />
    </>
  );
}
