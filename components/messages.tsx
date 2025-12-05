import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { ArrowDownIcon } from "lucide-react";
import { memo, useMemo, useEffect } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  selectedModelId: string;
};

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
  });

  useDataStream();

  // 去重消息列表：保留最后一条重复的消息（基于 message.id）
  // 这可以防止重试或流式响应时产生的重复消息导致 React key 警告
  // 同时过滤掉空消息（parts 为空或没有有效内容）
  const uniqueMessages = useMemo(() => {
    const seen = new Map<string, ChatMessage>();
    for (const message of messages) {
      seen.set(message.id, message);
    }
    const result = Array.from(seen.values());
    
    // 过滤空消息：parts 为空或没有有效的文本内容
    const filteredMessages = result.filter((message) => {
      const parts = message.parts || [];
      // 检查是否有有效的文本内容
      const hasValidText = parts.some(
        (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
      );
      // 检查是否有文件附件
      const hasAttachments = parts.some((p) => p.type === "file");
      // 检查是否有其他有效内容（reasoning、tool 等）
      const hasOtherContent = parts.some(
        (p) => p.type !== "text" && p.type !== "file"
      );
      
      // 保留有有效内容的消息
      return hasValidText || hasAttachments || hasOtherContent;
    });
    
    // 诊断日志：检查消息去重和过滤
    if (messages.length !== filteredMessages.length) {
      const removedCount = result.length - filteredMessages.length;
      console.log(`[Messages] 消息处理 - 对话 ${chatId}:`, {
        originalCount: messages.length,
        afterDedupe: result.length,
        afterFilter: filteredMessages.length,
        removedEmpty: removedCount,
        userMessages: filteredMessages.filter((m) => m.role === "user").length,
        assistantMessages: filteredMessages.filter((m) => m.role === "assistant").length,
        emptyMessages: result.filter((m) => {
          const parts = m.parts || [];
          const hasValidText = parts.some(
            (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
          );
          const hasAttachments = parts.some((p) => p.type === "file");
          return !hasValidText && !hasAttachments;
        }).map((m) => ({ id: m.id, role: m.role, partsCount: m.parts?.length || 0 })),
      });
    }
    
    return filteredMessages;
  }, [messages, chatId]);
  
  // 诊断日志：检查最终显示的消息
  useEffect(() => {
    console.log(`[Messages] 最终显示的消息 - 对话 ${chatId}:`, {
      totalMessages: uniqueMessages.length,
      userMessages: uniqueMessages.filter((m) => m.role === "user").length,
      assistantMessages: uniqueMessages.filter((m) => m.role === "assistant").length,
      messages: uniqueMessages.map((m) => ({
        id: m.id,
        role: m.role,
        partsCount: m.parts?.length || 0,
        hasText: m.parts?.some((p) => p.type === "text" && (p as any).text) || false,
      })),
    });
  }, [chatId, uniqueMessages]);

  return (
    <div className="relative flex-1">
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto"
        ref={messagesContainerRef}
      >
        <div className="flex min-w-0 flex-col gap-4 py-4 md:gap-6">
          {uniqueMessages.length === 0 && <Greeting />}

          {uniqueMessages.map((message, index) => (
            <PreviewMessage
              chatId={chatId}
              isLoading={
                status === "streaming" && uniqueMessages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              message={message}
              regenerate={regenerate}
              requiresScrollPadding={
                hasSentMessage && index === messages.length - 1
              }
              selectedModelId={selectedModelId}
              setMessages={setMessages}
              vote={
                votes
                  ? votes.find((vote) => vote.messageId === message.id)
                  : undefined
              }
            />
          ))}

          {/* 仅在等待agent回复时显示思考消息（不显示远端用户消息的等待） */}
          {status === "submitted" && (
            <ThinkingMessage 
              agentName={selectedModelId} 
              selectedModelId={selectedModelId}
            />
          )}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-label="滚动到底部"
        className={`-translate-x-1/2 absolute bottom-4 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-all hover:bg-muted ${
          isAtBottom
            ? "pointer-events-none scale-0 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-4" />
      </button>
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.isArtifactVisible && nextProps.isArtifactVisible) {
    return true;
  }

  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.selectedModelId !== nextProps.selectedModelId) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }
  if (!equal(prevProps.messages, nextProps.messages)) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }

  return false;
});
