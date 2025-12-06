"use client"

import type { UseChatHelpers } from "@ai-sdk/react"
import equal from "fast-deep-equal"
import { ArrowDownIcon } from "lucide-react"
import { memo, useMemo, useEffect } from "react"
import { useMessages } from "@/hooks/use-messages"
import type { Vote } from "@/lib/db/schema"
import type { ChatMessage } from "@/lib/types"
import { useDataStream } from "./data-stream-provider"
import { Greeting } from "./greeting"
import { PreviewMessage, ThinkingMessage } from "./message"

type MessagesProps = {
  chatId: string
  status: UseChatHelpers<ChatMessage>["status"]
  votes: Vote[] | undefined
  messages: ChatMessage[]
  setMessages: UseChatHelpers<ChatMessage>["setMessages"]
  regenerate: UseChatHelpers<ChatMessage>["regenerate"]
  isReadonly: boolean
  isArtifactVisible: boolean
  selectedModelId: string
}

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  selectedModelId,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  })

  useDataStream()

  useEffect(() => {
    const userMessages = messages.filter((m) => m.role === "user")
    const assistantMessages = messages.filter((m) => m.role === "assistant")
    console.log(
      "[v0] Messages render - total:",
      messages.length,
      "user:",
      userMessages.length,
      "assistant:",
      assistantMessages.length,
      "status:",
      status,
    )
    console.log(
      "[v0] User message IDs:",
      userMessages.map((m) => m.id.slice(0, 8)),
    )
    console.log(
      "[v0] Assistant message IDs:",
      assistantMessages.map((m) => m.id.slice(0, 8)),
    )
  }, [messages, status])

  // 去重消息列表：保留最后一条重复的消息（基于 message.id）
  // 这可以防止重试或流式响应时产生的重复消息导致 React key 警告
  // 同时过滤掉空消息（parts 为空或没有有效内容）
  const uniqueMessages = useMemo(() => {
    const seen = new Map<string, ChatMessage>()
    for (const message of messages) {
      seen.set(message.id, message)
    }
    const result = Array.from(seen.values())

    // 过滤空消息：parts 为空或没有有效的文本内容
    // 注意：用户消息应该总是有内容，不应该被过滤（除非确实为空）
    const filteredMessages = result.filter((message) => {
      const parts = message.parts || []

      if (message.role === "user") {
        // 用户消息总是保留
        return true
      }

      // 检查是否有有效的文本内容
      const hasValidText = parts.some((p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0)
      // 检查是否有文件附件
      const hasAttachments = parts.some((p) => p.type === "file")
      // 检查是否有其他有效内容（reasoning、tool 等）
      const hasOtherContent = parts.some((p) => p.type !== "text" && p.type !== "file")

      return hasValidText || hasAttachments || hasOtherContent
    })

    const filteredUserMessages = filteredMessages.filter((m) => m.role === "user")
    console.log(
      "[v0] uniqueMessages - before filter:",
      result.length,
      "after filter:",
      filteredMessages.length,
      "user messages after filter:",
      filteredUserMessages.length,
    )

    return filteredMessages
  }, [messages, chatId])

  // 当最后一条用户消息不在视口中时，确保滚动到可见位置
  // 注意：这个 useEffect 必须在 uniqueMessages 定义之后
  useEffect(() => {
    if (!messagesContainerRef.current || status !== "streaming") return

    const container = messagesContainerRef.current
    const lastUserMessage = uniqueMessages.filter((m) => m.role === "user").slice(-1)[0]

    if (lastUserMessage) {
      // 延迟检查，确保 DOM 已更新
      const timeoutId = setTimeout(() => {
        const messageElement = container.querySelector(`[data-message-id="${lastUserMessage.id}"]`) as HTMLElement
        if (messageElement) {
          const rect = messageElement.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          const isInViewport = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom

          // 如果消息不在视口中，滚动到消息位置
          if (!isInViewport) {
            // 计算消息相对于容器的位置
            const messageTopRelativeToContainer = rect.top - containerRect.top + container.scrollTop
            // 滚动到消息位置，留出一些边距
            const targetScrollTop = messageTopRelativeToContainer - containerRect.height / 2
            container.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: "smooth",
            })
          }
        }
      }, 200)

      return () => clearTimeout(timeoutId)
    }
  }, [status, uniqueMessages, messagesContainerRef])

  return (
    <div className="relative flex-1">
      <div className="absolute inset-0 touch-pan-y overflow-y-auto" ref={messagesContainerRef}>
        <div className="flex min-w-0 flex-col gap-4 py-4 md:gap-6">
          {uniqueMessages.length === 0 && <Greeting />}

          {uniqueMessages.map((message, index) => (
            <PreviewMessage
              chatId={chatId}
              isLoading={status === "streaming" && uniqueMessages.length - 1 === index}
              isReadonly={isReadonly}
              key={message.id}
              message={message}
              regenerate={regenerate}
              requiresScrollPadding={hasSentMessage && index === uniqueMessages.length - 1}
              selectedModelId={selectedModelId}
              setMessages={setMessages}
              vote={votes ? votes.find((vote) => vote.messageId === message.id) : undefined}
            />
          ))}

          {/* 仅在等待agent回复时显示思考消息（不显示远端用户消息的等待） */}
          {status === "submitted" && <ThinkingMessage agentName={selectedModelId} selectedModelId={selectedModelId} />}

          <div className="min-h-[24px] min-w-[24px] shrink-0" ref={messagesEndRef} />
        </div>
      </div>

      <button
        aria-label="滚动到底部"
        className={`-translate-x-1/2 absolute bottom-4 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-all hover:bg-muted ${
          isAtBottom ? "pointer-events-none scale-0 opacity-0" : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-4" />
      </button>
    </div>
  )
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // 调试日志
  console.log("[v0] Messages memo compare:", {
    prevLength: prevProps.messages.length,
    nextLength: nextProps.messages.length,
    prevStatus: prevProps.status,
    nextStatus: nextProps.status,
    isArtifactVisible: nextProps.isArtifactVisible,
  })

  if (prevProps.isArtifactVisible && nextProps.isArtifactVisible) {
    console.log("[v0] Messages memo: skipping update due to artifact visible")
    return true
  }

  if (prevProps.status !== nextProps.status) {
    console.log("[v0] Messages memo: status changed, will re-render")
    return false
  }
  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    console.log("[v0] Messages memo: length changed, will re-render")
    return false
  }

  // 检查消息内容是否变化
  const messagesEqual = equal(prevProps.messages, nextProps.messages)
  if (!messagesEqual) {
    console.log("[v0] Messages memo: content changed, will re-render")
    return false
  }

  if (!equal(prevProps.votes, nextProps.votes)) {
    return false
  }

  // 如果所有检查都通过，返回 true 表示不需要重新渲染
  console.log("[v0] Messages memo: no changes, skipping re-render")
  return true
})
