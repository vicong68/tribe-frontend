"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
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
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
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
    // 优化流式响应性能：使用 50ms throttle 平衡流畅度和性能
    // 参考 Vercel AI SDK 最佳实践：https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat
    experimental_throttle: 50,
    generateId: () => {
      // 如果有预生成的 ID，使用它；否则生成新的并存储到 ref 中
      // 注意：generateId 可能在 prepareSendMessagesRequest 之前被调用
      // 所以如果 ref 中没有 ID，我们在这里生成并存储，确保 prepareSendMessagesRequest 可以使用
      if (expectedAssistantMessageIdRef.current) {
        const id = expectedAssistantMessageIdRef.current;
        expectedAssistantMessageIdRef.current = null;
        return id;
      }
      const newId = generateUUID();
      expectedAssistantMessageIdRef.current = newId;
      return newId;
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        // ===== 关键修复：在 prepareSendMessagesRequest 中同步固化消息 =====
        // 此时 request.messages 已包含用户消息，且在 useChat 处理 text-start 之前执行
        // 这是最可靠的时机，确保用户消息在流式响应开始前被固化
        
        // 1. 同步固化所有消息（包括刚发送的用户消息）
        // 注意：request.messages 是 UIMessage[]，需要转换为 ChatMessage[]
        if (request.messages && request.messages.length > 0) {
          // 使用 messagesRef.current 获取最新的消息列表（已包含用户消息）
          // 因为此时 useChat 已经将用户消息添加到 messages 中
          const currentMessages = messagesRef.current;
          if (currentMessages.length > 0) {
            frozenHistoryMessagesRef.current = [...currentMessages];
            
            // 2. 追踪最后一条用户消息（作为最后的恢复手段）
            const lastMessage = currentMessages[currentMessages.length - 1];
            if (lastMessage.role === "user") {
              pendingUserMessageRef.current = lastMessage;
            }
          }
        }
        
        // 预生成 assistant 消息 ID，并存储到 ref 中
        // 这样 generateId 可以使用这个 ID，确保与后端匹配
        // 注意：必须在 generateId 被调用之前设置，所以在这里预生成
        expectedAssistantMessageIdRef.current = generateUUID();
        const assistantMessageId = expectedAssistantMessageIdRef.current;
        
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            expected_assistant_message_id: assistantMessageId, // 传递预生成的 ID
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
      
      // 用户-用户消息不需要流式状态（消息已通过SSE实时推送）
      // 检查最后一条消息是否是用户-用户消息
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      const isUserToUser = lastMessage?.metadata?.communicationType === "user_user";
      
      // 只有非用户-用户消息才设置为 streaming 状态
      if (!isUserToUser) {
      conversationManager.updateStatus("streaming");
      }
    },
    onFinish: () => {
      // 流式响应完成
      // 注意：消息保存已在服务器端（/api/chat/route.ts）处理
      // 符合 AI SDK 最佳实践：在服务器端保存消息，客户端只负责显示
      // 参考: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot/message-persistence
      // 
      // 客户端保存只作为兜底机制，在页面加载时通过 useMessagePersistence 检查恢复
      
      // 刷新聊天历史列表（使用 startTransition 优化性能）
      startTransition(() => {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
      });
      // 更新对话状态为 idle
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

  // 获取 SSE 消息上下文（用于接收用户-用户消息）
  const { onMessage: onSSEMessage, isConnected: sseConnected } = useSSEMessageContext();
  
  // 获取用户 ID 和登录状态（用于拉取离线消息）
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular"; // 只有登录用户才拉取离线消息
  const userId = isLoggedIn && session?.user
    ? getBackendMemberId(session.user)
    : null;
  
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
        
        // 检查是否已存在相同内容的消息（避免重复）
        const uniqueNewMessages = newMessages.filter((newMsg) => {
          const newTextPart = newMsg.parts?.find((p: any) => p.type === "text") as any;
          const newText = newTextPart?.text || "";
          return !prevMessages.some((existing) => {
            const existingTextPart = existing.parts?.find((p: any) => p.type === "text") as any;
            const existingText = existingTextPart?.text || "";
            return (
              existing.metadata?.senderId === newMsg.metadata?.senderId &&
              existing.metadata?.receiverId === newMsg.metadata?.receiverId &&
              existing.role === "assistant" &&
              existing.metadata?.communicationType === "user_user" &&
              existingText === newText
            );
          });
        });
        
        if (uniqueNewMessages.length === 0) {
          return prevMessages;
        }
        
        // 保存到数据库
        saveAssistantMessages(uniqueNewMessages).catch((error) => {
          console.error("[Chat] Failed to save offline messages to database:", error);
        });
        
        return [...prevMessages, ...uniqueNewMessages];
      });
    }, [setMessages, saveAssistantMessages]),
    onOfflineMessagesFetched: useCallback(() => {
      // 离线消息拉取完成后，触发用户列表和状态拉取
      // 通过清除缓存并触发刷新来实现
      import("@/lib/ai/models-client")
        .then(({ clearModelsCache }) => {
          clearModelsCache(true);
        })
        .catch(() => {
          // 静默处理导入错误
        });
    }, []),
  });

  // 更新 messagesRef 以跟踪最新的消息列表
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 处理 SSE 中的用户-用户消息
  useEffect(() => {
    const unsubscribe = onSSEMessage((sseMessage) => {
      // 只处理用户-用户消息
      if (sseMessage.communication_type !== "user_user") {
        return;
      }

      // 检查消息是否已经存在（避免重复添加）
      const existingMessage = messages.find(
        (msg) =>
          msg.metadata?.senderId === sseMessage.sender_id &&
          msg.metadata?.receiverId === sseMessage.receiver_id &&
          msg.role === "assistant" &&
          msg.metadata?.communicationType === "user_user" &&
          (msg.parts?.[0] as any)?.text === sseMessage.content
      );

      if (existingMessage) {
        return;
      }

      // 将 SSE 消息转换为 ChatMessage 格式
      const parts: any[] = [];
      
      // 添加文件附件（如果有）
      if (sseMessage.file_attachment) {
        parts.push({
          type: "file" as const,
          url: sseMessage.file_attachment.download_url || sseMessage.file_attachment.file_id,
          name: sseMessage.file_attachment.file_name || "file",
          mediaType: sseMessage.file_attachment.file_type || "application/octet-stream",
        });
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
        const alreadyExists = prevMessages.some(
          (msg) =>
            msg.metadata?.senderId === chatMessage.metadata?.senderId &&
            msg.metadata?.receiverId === chatMessage.metadata?.receiverId &&
            msg.role === "assistant" &&
            msg.metadata?.communicationType === "user_user" &&
            (msg.parts?.[0] as any)?.text === sseMessage.content
        );

        if (alreadyExists) {
          return prevMessages;
        }

        return [...prevMessages, chatMessage];
      });

      // 保存到数据库
      saveAssistantMessages([chatMessage]).catch((error) => {
        console.error("[Chat] Failed to save SSE message to database:", error);
      });
    });

    return unsubscribe;
  }, [onSSEMessage, messages, setMessages, saveAssistantMessages]);

  // 固化历史消息：当 messages 更新时，保存所有历史消息（除当前流式消息外）
  // 这可以防止 useChat 在处理流式响应时意外移除历史消息
  const frozenHistoryMessagesRef = useRef<ChatMessage[]>([]);
  const lastStreamingStatusRef = useRef<string>("idle");
  const lastMessagesLengthRef = useRef<number>(0);
  
  // 追踪刚发送的用户消息，作为最后的恢复手段
  // 关键：在 prepareSendMessagesRequest 中同步设置，确保在 useChat 处理 text-start 之前已固化
  const pendingUserMessageRef = useRef<ChatMessage | null>(null);
  
  // 监听 messages 变化，在每次变化时都尝试固化（更早的时机）
  // 注意：prepareSendMessagesRequest 中的同步固化是最关键的，这里的 useEffect 作为补充
  useEffect(() => {
    const isStreaming = status === "streaming";
    const wasStreaming = lastStreamingStatusRef.current === "streaming";
    const messagesLength = messages.length;
    const lastLength = lastMessagesLengthRef.current;
    
    // 关键：在消息数量增加时（用户发送消息后），立即固化
    // 这确保在 useChat 处理 text-start 之前，用户消息已经被固化
    if (messagesLength > lastLength && !isStreaming) {
      // 消息数量增加且不在流式传输中，立即固化（用户刚发送消息）
      frozenHistoryMessagesRef.current = [...messages];
      
      // 同时更新 pendingUserMessage
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === "user") {
        pendingUserMessageRef.current = lastMessage;
      }
    } else if (!wasStreaming && isStreaming) {
      // 从非 streaming 状态进入 streaming 状态时，固化当前所有消息为历史消息
      frozenHistoryMessagesRef.current = [...messages];
    } else if (wasStreaming && !isStreaming && messagesLength > 0) {
      // 流式传输结束，更新固化的历史消息（包含新完成的消息）
      frozenHistoryMessagesRef.current = [...messages];
      // 清除 pendingUserMessage（消息已成功接收）
      pendingUserMessageRef.current = null;
    }
    
    // 额外检查：如果 pendingUserMessage 在 messages 中，确保它被正确保留
    if (pendingUserMessageRef.current) {
      const pendingMessage = pendingUserMessageRef.current;
      const isPendingMessagePresent = messages.some(m => m.id === pendingMessage.id);
      
      if (!isPendingMessagePresent && isStreaming) {
        // pendingUserMessage 丢失，尝试恢复
        // 这会在 data-appendMessage 处理时被恢复
      } else if (isPendingMessagePresent) {
        // pendingUserMessage 已存在，可以清除（消息已成功接收）
        // 但保留到流式传输结束，确保完全稳定
      }
    }
    
    lastStreamingStatusRef.current = status;
    lastMessagesLengthRef.current = messagesLength;
  }, [messages, status]);

  // 处理 data-appendMessage 事件：在 useChat 处理完消息后更新 metadata
  // 标准逻辑：历史消息固化，仅更新当前消息
  const { dataStream } = useDataStream();
  const processedMetadataRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (!dataStream || dataStream.length === 0) return;

    const appendMessageEvents = dataStream.filter((part) => part.type === "data-appendMessage");
    if (appendMessageEvents.length === 0) return;

    appendMessageEvents.forEach((dataPart) => {
      try {
        const messageWithMetadata = JSON.parse(dataPart.data) as ChatMessage;
        const eventKey = `${messageWithMetadata.id}-${messageWithMetadata.role}`;
        
        if (processedMetadataRef.current.has(eventKey)) {
          return;
        }
        
        requestAnimationFrame(() => {
          setMessages((prevMessages) => {
            // ===== 标准消息渲染逻辑模板 =====
            // 1. 界定当前消息和历史消息
            //    当前消息：正在流式传输的消息（最后一条 assistant 消息，且 status === "streaming"）
            //    历史消息：除当前消息外的所有消息（固化，不应被修改）
            
            const isStreaming = status === "streaming";
            const lastMessage = prevMessages[prevMessages.length - 1];
            const isCurrentMessage = isStreaming && 
              lastMessage?.role === "assistant" && 
              (lastMessage.id === messageWithMetadata.id || 
               lastMessage.metadata?.originalMessageId === messageWithMetadata.id);
            
            // 2. 保护历史消息：合并固化的历史消息和当前消息列表
            //    确保即使用户消息在 prevMessages 中被移除，也能恢复
            const frozenHistory = frozenHistoryMessagesRef.current;
            const currentMessageIds = new Set(prevMessages.map(m => m.id));
            const frozenMessageIds = new Set(frozenHistory.map(m => m.id));
            
            // 找出被移除的历史消息（在固化列表中但不在当前列表中）
            const missingHistoryMessages = frozenHistory.filter(
              msg => !currentMessageIds.has(msg.id) && 
              // 排除当前流式消息（如果存在）
              !(isStreaming && lastMessage && msg.id === lastMessage.id)
            );
            
            // 3. 额外检查：如果 pendingUserMessage 丢失，也加入恢复列表
            const pendingUserMessage = pendingUserMessageRef.current;
            if (pendingUserMessage && !currentMessageIds.has(pendingUserMessage.id)) {
              // 确保 pendingUserMessage 不在 missingHistoryMessages 中（避免重复）
              const isAlreadyInMissing = missingHistoryMessages.some(m => m.id === pendingUserMessage.id);
              if (!isAlreadyInMissing) {
                missingHistoryMessages.push(pendingUserMessage);
              }
            }
            
            // 合并：当前消息列表 + 被移除的历史消息
            // 关键：确保用户消息插入到流式 assistant 消息之前，保证消息顺序正确
            let preservedMessages: ChatMessage[];
            if (missingHistoryMessages.length > 0) {
              // 如果有流式 assistant 消息，将丢失的消息插入到它之前
              if (isStreaming && lastMessage?.role === "assistant") {
                preservedMessages = [
                  ...prevMessages.slice(0, -1), // 除最后一条 assistant 消息外的所有消息
                  ...missingHistoryMessages,    // 丢失的历史消息（包括用户消息）
                  lastMessage,                  // 流式 assistant 消息
                ];
              } else {
                // 没有流式消息，直接追加
                preservedMessages = [...prevMessages, ...missingHistoryMessages];
              }
            } else {
              preservedMessages = prevMessages;
            }
            
            // 4. 查找要更新的消息（仅限当前消息或匹配的历史消息）
            let targetMessageIndex = -1;
            
            if (isCurrentMessage && messageWithMetadata.role === "assistant") {
              // 当前消息：最后一条 assistant 消息
              targetMessageIndex = preservedMessages.length - 1;
            } else {
              // 历史消息：通过 ID 查找（用于处理延迟到达的 metadata）
              for (let i = preservedMessages.length - 1; i >= 0; i--) {
                if (preservedMessages[i].id === messageWithMetadata.id ||
                    preservedMessages[i].metadata?.originalMessageId === messageWithMetadata.id) {
                  // 只更新匹配的消息，不更新其他历史消息
                  targetMessageIndex = i;
                  break;
                }
              }
            }
            
            // 5. 更新消息（仅更新目标消息，保留所有历史消息）
            if (targetMessageIndex >= 0) {
              const targetMessage = preservedMessages[targetMessageIndex];
              
              // 检查是否需要更新（metadata 或内容）
              const existingTextPart = targetMessage.parts?.find((p: any) => p.type === "text") as any;
              const newTextPart = messageWithMetadata.parts?.find((p: any) => p.type === "text") as any;
              const existingText = existingTextPart?.text || "";
              const newText = newTextPart?.text || "";
              const metadataChanged = !targetMessage.metadata || 
                JSON.stringify(targetMessage.metadata) !== JSON.stringify(messageWithMetadata.metadata);
              const contentChanged = newText.length > existingText.length;
              
              // 如果 metadata 或内容有变化，则更新
              if (metadataChanged || contentChanged) {
                const updatedMessages = [...preservedMessages];
                const existingMetadata = targetMessage.metadata || { createdAt: new Date().toISOString() };
                
                // 如果新消息内容更完整，则替换整个消息（包括 parts）
                // 否则只更新 metadata
                if (contentChanged) {
                  // 内容更完整，替换整个消息
                  updatedMessages[targetMessageIndex] = {
                    ...messageWithMetadata,
                    // 保留原有的 createdAt（如果存在），确保时间戳正确
                    metadata: {
                      ...existingMetadata,
                      ...messageWithMetadata.metadata,
                      createdAt: existingMetadata.createdAt || messageWithMetadata.metadata?.createdAt || new Date().toISOString(),
                    },
                  };
                } else {
                  // 只更新 metadata
                updatedMessages[targetMessageIndex] = {
                  ...targetMessage,
                  metadata: {
                    ...existingMetadata,
                    ...messageWithMetadata.metadata,
                    createdAt: existingMetadata.createdAt || messageWithMetadata.metadata?.createdAt || new Date().toISOString(),
                  },
                };
                }
                
                processedMetadataRef.current.add(eventKey);
                return updatedMessages;
              } else {
                processedMetadataRef.current.add(eventKey);
              }
            } else {
              // 6. 如果没有找到匹配的消息，且不在流式传输中，添加新消息
              // 注意：在流式传输中，新消息应该由 useChat 处理，这里不添加
              // 但在页面刷新恢复场景中，可能需要添加
              if (!isStreaming && messageWithMetadata.role === "assistant") {
                // 检查是否是页面刷新恢复场景：消息不在列表中，但应该存在
                // 这种情况下，添加消息到列表末尾
                const updatedMessages = [...preservedMessages, messageWithMetadata];
                processedMetadataRef.current.add(eventKey);
                return updatedMessages;
              }
            }
            
            // 7. 如果没有找到匹配的消息且不需要添加，返回保护后的消息列表（历史消息固化）
            return preservedMessages;
          });
        });
      } catch (error) {
        // 静默处理错误
      }
    });
  }, [dataStream, status, setMessages]);

  // 包装 sendMessage，在发送前立即固化消息
  const sendMessage = useCallback((message: any) => {
    // 在发送消息前，立即固化当前所有消息
    // 这确保在 useChat 处理 text-start 之前，用户消息已经被固化
    // 注意：useChat 会在 sendMessage 调用后立即添加用户消息到 messages
    // 但我们在发送前固化，然后在 useEffect 中会再次固化（包含新消息）
    frozenHistoryMessagesRef.current = [...messages];
    
    // 调用原始的 sendMessage
    return originalSendMessage(message);
  }, [messages, originalSendMessage]);

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
          messages={messages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
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
