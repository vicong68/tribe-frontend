"use client"
import { DefaultChatTransport } from "ai"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState, startTransition } from "react"
import useSWR, { useSWRConfig } from "swr"
import { unstable_serialize } from "swr/infinite"
import { ChatHeader } from "@/components/chat-header"
import { useArtifactSelector } from "@/hooks/use-artifact"
import { useAutoResume } from "@/hooks/use-auto-resume"
import { useChatVisibility } from "@/hooks/use-chat-visibility"
import { useConversationManager } from "@/hooks/use-conversation-manager"
import { useMessagePersistence } from "@/hooks/use-message-persistence"
import { useStreamChatWithRetry } from "@/hooks/use-stream-chat-with-retry"
import type { Vote } from "@/lib/db/schema"
import { ChatSDKError } from "@/lib/errors"
import type { Attachment, ChatMessage } from "@/lib/types"
import type { AppUsage } from "@/lib/usage"
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils"
import { Artifact } from "./artifact"
import { Messages } from "./messages"
import { MultimodalInput } from "./multimodal-input"
import { getChatHistoryPaginationKey } from "./sidebar-history"
import { toast } from "./toast"
import { useDataStream } from "./data-stream-provider"

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
}) {
  const router = useRouter()

  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  })

  const { mutate } = useSWRConfig()

  // 使用 ref 存储预生成的 assistant 消息 ID
  const expectedAssistantMessageIdRef = useRef<string | null>(null)

  const pendingUserMessageRef = useRef<ChatMessage | null>(null)

  const [input, setInput] = useState<string>("")
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext)
  const [currentModelId, setCurrentModelId] = useState(initialChatModel)
  const currentModelIdRef = useRef(currentModelId)
  const messagesRef = useRef<ChatMessage[]>(initialMessages)

  // 会话管理器
  const conversationManager = useConversationManager(id)

  useEffect(() => {
    currentModelIdRef.current = currentModelId
  }, [currentModelId])

  const { setDataStream } = useDataStream()
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
    experimental_throttle: 50,
    generateId: () => {
      if (expectedAssistantMessageIdRef.current) {
        const id = expectedAssistantMessageIdRef.current
        expectedAssistantMessageIdRef.current = null
        return id
      }
      const newId = generateUUID()
      expectedAssistantMessageIdRef.current = newId
      return newId
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        expectedAssistantMessageIdRef.current = generateUUID()
        const assistantMessageId = expectedAssistantMessageIdRef.current

        // 这是关键修复：确保在 useChat 处理 text-start 之前，用户消息已经被固化
        // request.messages 包含了所有消息（包括新的用户消息）
        const allMessages = request.messages as ChatMessage[]
        if (allMessages.length > 0) {
          // 同步更新固化的历史消息
          frozenHistoryMessagesRef.current = [...allMessages]
          // 同时更新 pendingUserMessageRef，以便在恢复时使用
          const lastMessage = allMessages[allMessages.length - 1]
          if (lastMessage.role === "user") {
            pendingUserMessageRef.current = lastMessage
          }
        }

        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            expected_assistant_message_id: assistantMessageId,
            ...request.body,
          },
        }
      },
    }),
    onData: (dataPart: any) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []))
      if (dataPart.type === "data-usage") {
        setUsage(dataPart.data)
      }

      conversationManager.updateStatus("streaming")
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
        mutate(unstable_serialize(getChatHistoryPaginationKey))
      })
      // 更新对话状态为 idle
      conversationManager.updateStatus("idle")

      pendingUserMessageRef.current = null
    },
    onError: (error) => {
      // 更新对话状态为 idle（错误时）
      conversationManager.updateStatus("idle")

      // 根据错误类型提供更友好的错误提示
      if (error instanceof ChatSDKError) {
        toast({
          type: "error",
          description: error.message,
        })
      } else if (error instanceof Error) {
        // 网络错误或未知错误
        const errorMessage = error.message || "发生未知错误"
        const isNetworkError =
          errorMessage.includes("network") ||
          errorMessage.includes("fetch") ||
          errorMessage.includes("offline") ||
          errorMessage.includes("Failed to fetch")

        toast({
          type: "error",
          description: isNetworkError ? "网络连接失败，请检查网络后重试" : `错误：${errorMessage}`,
        })
      } else {
        toast({
          type: "error",
          description: "发生未知错误，请稍后重试",
        })
      }

      pendingUserMessageRef.current = null
    },
  })

  const { saveAssistantMessages } = useMessagePersistence({
    chatId: id,
    messages,
  })

  // 更新 messagesRef 以跟踪最新的消息列表
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 固化历史消息：当 messages 更新时，保存所有历史消息（除当前流式消息外）
  const frozenHistoryMessagesRef = useRef<ChatMessage[]>([])
  const lastStreamingStatusRef = useRef<string>("idle")
  const lastMessagesLengthRef = useRef<number>(0)

  useEffect(() => {
    const userMessages = messages.filter((m) => m.role === "user")
    const assistantMessages = messages.filter((m) => m.role === "assistant")
    console.log("[v0] Chat messages state changed:", {
      total: messages.length,
      user: userMessages.length,
      assistant: assistantMessages.length,
      status,
      frozenLength: frozenHistoryMessagesRef.current.length,
      pendingUser: pendingUserMessageRef.current?.id?.slice(0, 8) || null,
    })
  }, [messages, status])

  // 监听 messages 变化，在每次变化时都尝试固化（更早的时机）
  useEffect(() => {
    const isStreaming = status === "streaming"
    const wasStreaming = lastStreamingStatusRef.current === "streaming"
    const messagesLength = messages.length
    const lastLength = lastMessagesLengthRef.current

    // 如果有 pendingUserMessage，确保它被包含在固化的消息中
    const pendingUserMessage = pendingUserMessageRef.current

    console.log("[v0] Freeze logic check:", {
      isStreaming,
      wasStreaming,
      messagesLength,
      lastLength,
      pendingUserId: pendingUserMessage?.id?.slice(0, 8) || null,
    })

    if (messagesLength > lastLength && !isStreaming) {
      // 消息数量增加且不在流式传输中，立即固化
      console.log("[v0] Freezing: message count increased, not streaming")
      frozenHistoryMessagesRef.current = [...messages]
    } else if (!wasStreaming && isStreaming) {
      // 从非 streaming 状态进入 streaming 状态时，固化当前所有消息
      // 同时确保 pendingUserMessage 被包含
      const currentMessages = [...messages]
      if (pendingUserMessage && !currentMessages.some((m) => m.id === pendingUserMessage.id)) {
        // 用户消息不在 messages 中，需要手动添加
        // 找到正确的插入位置（在最后一条 assistant 消息之前）
        const lastAssistantIndex = currentMessages.findLastIndex((m) => m.role === "assistant")
        if (lastAssistantIndex > 0) {
          currentMessages.splice(lastAssistantIndex, 0, pendingUserMessage)
        } else {
          // 如果没有 assistant 消息或只有一条，添加到末尾前一位
          currentMessages.push(pendingUserMessage)
        }
      }
      console.log("[v0] Freezing: entering streaming state")
      frozenHistoryMessagesRef.current = currentMessages
    } else if (wasStreaming && !isStreaming && messagesLength > 0) {
      // 流式传输结束，更新固化的历史消息
      console.log("[v0] Freezing: streaming ended")
      frozenHistoryMessagesRef.current = [...messages]
      pendingUserMessageRef.current = null
    }

    lastStreamingStatusRef.current = status
    lastMessagesLengthRef.current = messagesLength
  }, [messages, status])

  // 处理 data-appendMessage 事件：在 useChat 处理完消息后更新 metadata
  // 标准逻辑：历史消息固化，仅更新当前消息
  const { dataStream } = useDataStream()
  const processedMetadataRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!dataStream || dataStream.length === 0) return

    const appendMessageEvents = dataStream.filter((part) => part.type === "data-appendMessage")
    if (appendMessageEvents.length === 0) return

    appendMessageEvents.forEach((dataPart) => {
      try {
        const messageWithMetadata = JSON.parse(dataPart.data) as ChatMessage
        const eventKey = `${messageWithMetadata.id}-${messageWithMetadata.role}`

        if (processedMetadataRef.current.has(eventKey)) {
          return
        }

        requestAnimationFrame(() => {
          setMessages((prevMessages) => {
            const isStreaming = status === "streaming"
            const lastMessage = prevMessages[prevMessages.length - 1]
            const isCurrentMessage =
              isStreaming &&
              lastMessage?.role === "assistant" &&
              (lastMessage.id === messageWithMetadata.id ||
                lastMessage.metadata?.originalMessageId === messageWithMetadata.id)

            const frozenHistory = frozenHistoryMessagesRef.current
            const pendingUserMessage = pendingUserMessageRef.current
            const currentMessageIds = new Set(prevMessages.map((m) => m.id))

            // 找出被移除的历史消息
            const missingHistoryMessages = frozenHistory.filter(
              (msg) => !currentMessageIds.has(msg.id) && !(isStreaming && lastMessage && msg.id === lastMessage.id),
            )

            if (
              pendingUserMessage &&
              !currentMessageIds.has(pendingUserMessage.id) &&
              !missingHistoryMessages.some((m) => m.id === pendingUserMessage.id)
            ) {
              missingHistoryMessages.push(pendingUserMessage)
            }

            // 合并：当前消息列表 + 被移除的历史消息
            let preservedMessages = missingHistoryMessages.length > 0 ? [...prevMessages] : prevMessages

            if (missingHistoryMessages.length > 0) {
              // 找到第一条流式 assistant 消息的位置
              const streamingAssistantIndex = preservedMessages.findIndex(
                (m) => m.role === "assistant" && isStreaming && m.id === lastMessage?.id,
              )

              if (streamingAssistantIndex > 0) {
                // 在流式消息之前插入丢失的消息
                preservedMessages = [
                  ...preservedMessages.slice(0, streamingAssistantIndex),
                  ...missingHistoryMessages,
                  ...preservedMessages.slice(streamingAssistantIndex),
                ]
              } else {
                // 没有找到流式消息，直接添加到末尾前
                preservedMessages = [...prevMessages, ...missingHistoryMessages]
              }
            }

            // 查找要更新的消息（仅限当前消息或匹配的历史消息）
            let targetMessageIndex = -1

            if (isCurrentMessage && messageWithMetadata.role === "assistant") {
              targetMessageIndex = preservedMessages.length - 1
            } else {
              for (let i = preservedMessages.length - 1; i >= 0; i--) {
                if (
                  preservedMessages[i].id === messageWithMetadata.id ||
                  preservedMessages[i].metadata?.originalMessageId === messageWithMetadata.id
                ) {
                  targetMessageIndex = i
                  break
                }
              }
            }

            if (targetMessageIndex >= 0) {
              const targetMessage = preservedMessages[targetMessageIndex]

              const needsUpdate =
                !targetMessage.metadata ||
                JSON.stringify(targetMessage.metadata) !== JSON.stringify(messageWithMetadata.metadata)

              if (needsUpdate) {
                const updatedMessages = [...preservedMessages]
                const existingMetadata = targetMessage.metadata || { createdAt: new Date().toISOString() }

                updatedMessages[targetMessageIndex] = {
                  ...targetMessage,
                  metadata: {
                    ...existingMetadata,
                    ...messageWithMetadata.metadata,
                    createdAt:
                      existingMetadata.createdAt || messageWithMetadata.metadata?.createdAt || new Date().toISOString(),
                  },
                }

                processedMetadataRef.current.add(eventKey)
                return updatedMessages
              } else {
                processedMetadataRef.current.add(eventKey)
              }
            }

            return preservedMessages
          })
        })
      } catch (error) {
        // 静默处理错误
      }
    })
  }, [dataStream, status, setMessages])

  // 包装 sendMessage，在发送前立即固化消息
  const sendMessage = useCallback(
    (message: any) => {
      // 这样即使 useChat 重建 messages，我们也能恢复
      if (message && message.role === "user") {
        pendingUserMessageRef.current = message
      }

      frozenHistoryMessagesRef.current = [...messages]

      return originalSendMessage(message)
    },
    [messages, originalSendMessage],
  )

  useEffect(() => {
    const isSwitching = conversationManager.detectAgentSwitch(currentModelId)
    if (isSwitching && status === "streaming") {
      stop()
    }
  }, [currentModelId, conversationManager, status, stop])

  const searchParams = useSearchParams()
  const query = searchParams.get("query")

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false)

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      })

      setHasAppendedQuery(true)
      window.history.replaceState({}, "", `/chat/${id}`)
    }
  }, [query, sendMessage, hasAppendedQuery, id])

  const { data: votes } = useSWR<Vote[]>(messages.length >= 2 ? `/api/vote?chatId=${id}` : null, fetcher)

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible)

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
    chatId: id,
    currentAgentId: currentModelId,
    conversationManager,
  })

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader chatId={id} isReadonly={isReadonly} selectedVisibilityType={initialVisibilityType} />

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
  )
}
