"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { useConversationManager } from "@/hooks/use-conversation-manager";
import { useMessagePersistence } from "@/hooks/use-message-persistence";
import { useStreamChatWithRetry } from "@/hooks/use-stream-chat-with-retry";
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { Artifact } from "./artifact";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

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
      
      conversationManager.updateStatus("streaming");
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

  // 更新 messagesRef 以跟踪最新的消息列表
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 固化历史消息：当 messages 更新时，保存所有历史消息（除当前流式消息外）
  // 这可以防止 useChat 在处理流式响应时意外移除历史消息
  const frozenHistoryMessagesRef = useRef<ChatMessage[]>([]);
  const lastStreamingStatusRef = useRef<string>("idle");
  const lastMessagesLengthRef = useRef<number>(0);
  
  // 监听 messages 变化，在每次变化时都尝试固化（更早的时机）
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
    } else if (!wasStreaming && isStreaming) {
      // 从非 streaming 状态进入 streaming 状态时，固化当前所有消息为历史消息
      frozenHistoryMessagesRef.current = [...messages];
    } else if (wasStreaming && !isStreaming && messagesLength > 0) {
      // 流式传输结束，更新固化的历史消息（包含新完成的消息）
      frozenHistoryMessagesRef.current = [...messages];
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
            
            // 合并：当前消息列表 + 被移除的历史消息
            const preservedMessages = missingHistoryMessages.length > 0
              ? [...prevMessages, ...missingHistoryMessages]
              : prevMessages;
            
            // 3. 查找要更新的消息（仅限当前消息或匹配的历史消息）
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
            
            // 4. 更新消息（仅更新目标消息，保留所有历史消息）
            if (targetMessageIndex >= 0) {
              const targetMessage = preservedMessages[targetMessageIndex];
              
              // 检查是否需要更新 metadata
              const needsUpdate = !targetMessage.metadata || 
                JSON.stringify(targetMessage.metadata) !== JSON.stringify(messageWithMetadata.metadata);
              
              if (needsUpdate) {
                const updatedMessages = [...preservedMessages];
                const existingMetadata = targetMessage.metadata || { createdAt: new Date().toISOString() };
                
                // 仅更新目标消息的 metadata，保留其他所有消息不变（历史消息固化）
                updatedMessages[targetMessageIndex] = {
                  ...targetMessage,
                  metadata: {
                    ...existingMetadata,
                    ...messageWithMetadata.metadata,
                    createdAt: existingMetadata.createdAt || messageWithMetadata.metadata?.createdAt || new Date().toISOString(),
                  },
                };
                
                processedMetadataRef.current.add(eventKey);
                return updatedMessages;
              } else {
                processedMetadataRef.current.add(eventKey);
              }
            }
            
            // 5. 如果没有找到匹配的消息，返回保护后的消息列表（历史消息固化）
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
