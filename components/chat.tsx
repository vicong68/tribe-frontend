"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    isRetrying,
  } = useStreamChatWithRetry<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
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
      
      // 刷新聊天历史列表
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      // 更新对话状态为 idle
      conversationManager.updateStatus("idle");
    },
    onError: (error) => {
      // 更新对话状态为 idle（错误时）
      conversationManager.updateStatus("idle");
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
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

  // 处理 data-appendMessage 事件：在 useChat 处理完消息后更新 metadata
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
            const prevUserMessages = prevMessages.filter((m) => m.role === "user");
            
            let existingMessageIndex = -1;
            
            if (messageWithMetadata.role === "assistant") {
              for (let i = prevMessages.length - 1; i >= 0; i--) {
                if (prevMessages[i].role === "assistant") {
                  if (prevMessages[i].id === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  if (prevMessages[i].metadata?.originalMessageId === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  break;
                }
              }
            } else if (messageWithMetadata.role === "user") {
              for (let i = prevMessages.length - 1; i >= 0; i--) {
                if (prevMessages[i].role === "user") {
                  if (prevMessages[i].id === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  break;
                }
              }
            }
            
            if (existingMessageIndex >= 0) {
              const updatedMessages = [...prevMessages];
              const existingMessage = updatedMessages[existingMessageIndex];
              
              const needsUpdate = !existingMessage.metadata || 
                JSON.stringify(existingMessage.metadata) !== JSON.stringify(messageWithMetadata.metadata);
              
              if (needsUpdate) {
                const existingMetadata = existingMessage.metadata || { createdAt: new Date().toISOString() };
                updatedMessages[existingMessageIndex] = {
                  ...existingMessage,
                  metadata: {
                    ...existingMetadata,
                    ...messageWithMetadata.metadata,
                    createdAt: existingMetadata.createdAt || messageWithMetadata.metadata?.createdAt || new Date().toISOString(),
                  },
                };
                
                processedMetadataRef.current.add(eventKey);
                
                const updatedUserMessages = updatedMessages.filter((m) => m.role === "user");
                if (prevUserMessages.length > updatedUserMessages.length) {
                  const missingUserMessages = prevUserMessages.filter(
                    (m) => !updatedUserMessages.some((um) => um.id === m.id)
                  );
                  return [...updatedMessages, ...missingUserMessages];
                }
                
                return updatedMessages;
              } else {
                processedMetadataRef.current.add(eventKey);
              }
            }
            
            return prevMessages;
          });
        });
      } catch (error) {
        // 静默处理错误
      }
    });
  }, [dataStream, messages, setMessages]);

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

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
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
