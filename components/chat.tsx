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

  // 诊断日志：检查 initialMessages
  useEffect(() => {
    console.log(`[Chat] 组件初始化 - 对话 ${id}:`, {
      initialMessagesCount: initialMessages.length,
      initialUserMessages: initialMessages.filter((m) => m.role === "user").length,
      initialAssistantMessages: initialMessages.filter((m) => m.role === "assistant").length,
      initialMessages: initialMessages.map((m) => ({
        id: m.id,
        role: m.role,
        partsCount: m.parts?.length || 0,
        hasMetadata: !!m.metadata,
      })),
    });
  }, [id, initialMessages]);

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
        expectedAssistantMessageIdRef.current = null; // 使用后清空，避免重复使用
        console.log(`[Chat] ✅ Using pre-generated assistant message ID from ref: ${id}`);
        return id;
      }
      // 如果没有预生成的 ID，生成新的并存储到 ref 中
      // 这样 prepareSendMessagesRequest 可以使用这个 ID
      const newId = generateUUID();
      expectedAssistantMessageIdRef.current = newId; // 存储到 ref 中，供 prepareSendMessagesRequest 使用
      console.log(`[Chat] ✅ Generated new assistant message ID in generateId: ${newId}`);
      return newId;
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        // 预生成 assistant 消息 ID，并存储到 ref 中
        // 这样 generateId 可以使用这个 ID，确保与后端匹配
        // 注意：必须在 generateId 被调用之前设置，所以在这里预生成
        // 每次发送消息时都生成新的 ID（清空之前的 ID）
        expectedAssistantMessageIdRef.current = generateUUID();
        const assistantMessageId = expectedAssistantMessageIdRef.current;
        console.log(`[Chat] ✅ Pre-generated assistant message ID in prepareSendMessagesRequest: ${assistantMessageId}`);
        
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
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === "data-usage") {
        setUsage(dataPart.data);
      }
      
      // 注意：现在 useChat 使用预生成的 ID，应该与后端匹配
      // 不再需要处理 text-start 事件来更新消息 ID
      
      // 处理 data-appendMessage 事件：更新消息的 metadata
      // 注意：AI SDK 的 useChat 会自动处理 data-appendMessage，但我们需要确保 metadata 被正确更新
      // 关键：只更新 metadata，不重复添加消息（避免重复显示）
      if (dataPart.type === "data-appendMessage") {
        try {
          const messageWithMetadata = JSON.parse(dataPart.data) as ChatMessage;
          
          // 更新消息列表中的对应消息，确保 metadata 被正确设置
          setMessages((prevMessages) => {
            // 对于 assistant 消息，查找最后一条 assistant 消息（useChat 在流式响应时会逐步构建消息）
            // 对于 user 消息，查找最后一条 user 消息
            let existingMessageIndex = -1;
            
            if (messageWithMetadata.role === "assistant") {
              // 查找最后一条 assistant 消息（流式响应时，useChat 会逐步构建消息）
              for (let i = prevMessages.length - 1; i >= 0; i--) {
                if (prevMessages[i].role === "assistant") {
                  // 检查 ID 是否匹配（现在后端使用前端提供的 expected_assistant_message_id，应该匹配）
                  if (prevMessages[i].id === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  
                  // 如果 ID 不匹配（兜底逻辑），检查是否有通过 originalMessageId 匹配的消息
                  if (prevMessages[i].metadata?.originalMessageId === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  
                  // 如果 ID 仍然不匹配，但消息内容相似（兜底逻辑），也认为是同一条消息
                  // 检查消息是否有相同的 parts（至少部分相同）
                  const existingParts = prevMessages[i].parts || [];
                  const newParts = messageWithMetadata.parts || [];
                  if (existingParts.length > 0 && newParts.length > 0) {
                    // 比较第一个 text part 的内容
                    const existingText = existingParts.find((p: any) => p.type === "text")?.text || "";
                    const newText = newParts.find((p: any) => p.type === "text")?.text || "";
                    if (existingText && newText) {
                      // 检查内容是否匹配（双向匹配：新消息包含旧消息，或旧消息包含新消息）
                      if (newText.includes(existingText) || existingText.includes(newText)) {
                        // 认为是同一条消息，更新 ID 和 metadata
                        existingMessageIndex = i;
                        break;
                      }
                    }
                  }
                  // 只检查最后一条 assistant 消息
                  break;
                }
              }
            } else if (messageWithMetadata.role === "user") {
              // 查找最后一条 user 消息
              for (let i = prevMessages.length - 1; i >= 0; i--) {
                if (prevMessages[i].role === "user") {
                  if (prevMessages[i].id === messageWithMetadata.id) {
                    existingMessageIndex = i;
                    break;
                  }
                  // 只检查最后一条 user 消息
                  break;
                }
              }
            }
            
            if (existingMessageIndex >= 0) {
              // 消息已存在，只更新 metadata（不重复添加）
              const updatedMessages = [...prevMessages];
              const existingMessage = updatedMessages[existingMessageIndex];
              updatedMessages[existingMessageIndex] = {
                ...existingMessage,
                // 保留现有的 parts（流式响应时可能还在更新），只更新 metadata
                metadata: {
                  ...existingMessage.metadata,
                  ...messageWithMetadata.metadata,
                },
              };
              console.log(`[Chat] ✅ Updated existing message metadata via data-appendMessage:`, {
                messageId: messageWithMetadata.id,
                existingMessageId: existingMessage.id,
                role: messageWithMetadata.role,
                oldMetadata: existingMessage.metadata,
                newMetadata: messageWithMetadata.metadata,
                mergedMetadata: updatedMessages[existingMessageIndex].metadata,
              });
              return updatedMessages;
            } else {
              // 消息不存在，检查是否有通过 originalMessageId 匹配的消息（ID 被转换的情况）
              const messageWithOriginalId = prevMessages.find((msg) => 
                msg.metadata?.originalMessageId === messageWithMetadata.id
              );
              
              if (messageWithOriginalId) {
                // 找到通过 originalMessageId 匹配的消息，更新它
                const updatedMessages = prevMessages.map((msg) => {
                  if (msg.metadata?.originalMessageId === messageWithMetadata.id) {
                    return {
                      ...msg,
                      metadata: {
                        ...msg.metadata,
                        ...messageWithMetadata.metadata,
                      },
                    };
                  }
                  return msg;
                });
                console.log(`[Chat] ✅ Updated message metadata via originalMessageId:`, {
                  originalId: messageWithMetadata.id,
                  actualId: messageWithOriginalId.id,
                  metadata: messageWithMetadata.metadata,
                });
                return updatedMessages;
              }
              
              // 消息不存在且无法匹配，不添加新消息（避免重复）
              // 只记录警告，不添加消息（因为 useChat 已经处理了消息的添加）
              console.warn(`[Chat] ⚠️ Message not found for data-appendMessage, skipping (useChat will handle):`, {
                messageId: messageWithMetadata.id,
                role: messageWithMetadata.role,
                existingMessageIds: prevMessages.map((m) => ({ id: m.id, role: m.role })),
              });
              return prevMessages;
            }
          });
        } catch (error) {
          console.error("[Chat] Failed to parse data-appendMessage:", error);
        }
      }
      // 更新对话状态为 streaming
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

  // 消息持久化 Hook（符合 AI SDK 规范）
  // 注意：消息保存主要在服务器端处理，这里只用于页面加载时的恢复检查
  const { saveAssistantMessages } = useMessagePersistence({
    chatId: id,
    messages,
    onSaveComplete: (savedCount) => {
      if (savedCount > 0) {
        console.log(`[Chat] ✅ Restored ${savedCount} message(s) on page load`);
      }
    },
  });

  // 更新 messagesRef 以跟踪最新的消息列表
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 检测 agent 切换并处理（放在 useStreamChatWithRetry 之后，以便访问 stop）
  useEffect(() => {
    const isSwitching = conversationManager.detectAgentSwitch(currentModelId);
    if (isSwitching && status === "streaming") {
      // Agent 切换时，如果正在流式传输，停止当前的流
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
