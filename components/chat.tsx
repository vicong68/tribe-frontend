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
      
      // 用户-用户消息不需要流式状态（消息已通过SSE实时推送）
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      const isUserToUser = lastMessage?.metadata?.communicationType === "user_user";
      
      if (!isUserToUser) {
        conversationManager.updateStatus("streaming");
      }
    },
    onFinish: () => {
      // 流式响应完成：标记状态为 idle
      // 消息保存通过 useEffect 监听 status 变化来处理，确保使用最新的 messages 状态
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

  // 流式响应完成后保存 assistant 消息
  // 使用 useEffect 监听 status 变化，确保使用最新的 messages 状态
  // 符合 Vercel AI SDK 最佳实践：在流式响应完成后保存消息
  // 记录上一次的流式状态，用于检测 streaming 结束
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const currentStatus = status;
    // 当状态从 "streaming" 变为非 "streaming" 时，保存 assistant 消息
    if (prevStatusRef.current === "streaming" && currentStatus !== "streaming") {
      // 使用最新的 messages 状态，而不是 ref
      const assistantMessages = messages.filter((msg) => msg.role === "assistant");
      
      if (assistantMessages.length > 0) {
        // 延迟一小段时间，确保 AI SDK 已完全更新 messages 状态
        // 使用 setTimeout 确保在下一个事件循环中执行
        const timeoutId = setTimeout(() => {
          saveAssistantMessagesRef.current(assistantMessages).catch((error) => {
            if (process.env.NODE_ENV === "development") {
              console.error("[Chat] Failed to save messages on finish:", error);
            }
          });
        }, 100);
        
        return () => clearTimeout(timeoutId);
      }
    }
    
    prevStatusRef.current = currentStatus;
  }, [status, messages]);

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
            const updated = [...prev];
            updated[targetIndex] = {
              ...prev[targetIndex],
              metadata: {
                ...prev[targetIndex].metadata,
                ...messageWithMetadata.metadata,
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
          messages={messages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
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
