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
  sendMessage?: (message: ChatMessage) => void;
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
  sendMessage,
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
    // 注意：用户消息应该总是有内容，不应该被过滤（除非确实为空）
    const filteredMessages = result.filter((message) => {
      const parts = message.parts || [];
      
      if (message.role === "user") {
        // 用户消息总是保留
        return true;
      }
      
      // 检查是否有有效的文本内容
      const hasValidText = parts.some(
        (p) => p && typeof p === 'object' && p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
      );
      // 检查是否有文件附件
      const hasAttachments = parts.some((p) => p && typeof p === 'object' && p.type === "file");
      // 检查是否有其他有效内容（reasoning、tool 等）
      // 注意：排除 "data-appendMessage" 类型，这是错误格式
      const hasOtherContent = parts.some(
        (p) => p && typeof p === 'object' && p.type !== "text" && p.type !== "file" && p.type !== "data-appendMessage"
      );
      
      return hasValidText || hasAttachments || hasOtherContent;
    });
    
    return filteredMessages;
  }, [messages, chatId]);
  
  // 当最后一条用户消息不在视口中时，确保滚动到可见位置
  // 注意：这个 useEffect 必须在 uniqueMessages 定义之后
  useEffect(() => {
    if (!messagesContainerRef.current || status !== "streaming") return;
    
    const container = messagesContainerRef.current;
    const lastUserMessage = uniqueMessages.filter(m => m.role === "user").slice(-1)[0];
    
    if (lastUserMessage) {
      // 延迟检查，确保 DOM 已更新
      const timeoutId = setTimeout(() => {
        const messageElement = container.querySelector(`[data-message-id="${lastUserMessage.id}"]`) as HTMLElement;
        if (messageElement) {
          const rect = messageElement.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const isInViewport = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
          
          // 如果消息不在视口中，滚动到消息位置
          if (!isInViewport) {
            // 计算消息相对于容器的位置
            const messageTopRelativeToContainer = rect.top - containerRect.top + container.scrollTop;
            // 滚动到消息位置，留出一些边距
            const targetScrollTop = messageTopRelativeToContainer - containerRect.height / 2;
            container.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: "smooth",
            });
          }
        }
      }, 200);
      
      return () => clearTimeout(timeoutId);
    }
  }, [status, uniqueMessages, messagesContainerRef]);


  return (
    <div className="relative flex-1">
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto"
        ref={messagesContainerRef}
      >
        <div className="flex min-w-0 flex-col gap-4 py-4 md:gap-6">
          {uniqueMessages.length === 0 && <Greeting />}

          {uniqueMessages.map((message, index) => {
            // ✅ 关键修复：准确判断是否是流式回复消息，确保思考消息被正确替换
            // 流式回复消息的特征：
            // 1. 是最后一条消息（index === uniqueMessages.length - 1）
            // 2. 状态是 streaming
            // 3. 角色是 assistant
            // 4. 没有有效内容或内容为空（流式刚开始时）
            const isLastMessage = index === uniqueMessages.length - 1;
            const isStreamingAssistant = status === "streaming" && 
                                         isLastMessage && 
                                         message.role === "assistant";
            const hasValidContent = message.parts?.some(
              (p: any) => p.type === "text" && p.text && p.text.trim().length > 0
            ) || message.parts?.some((p: any) => p.type !== "text");
            
            return (
              <PreviewMessage
                chatId={chatId}
                isLoading={isStreamingAssistant && !hasValidContent}
                isReadonly={isReadonly}
                key={message.id}
                message={message}
                regenerate={regenerate}
                requiresScrollPadding={
                  hasSentMessage && isLastMessage
                }
                selectedModelId={selectedModelId}
                setMessages={setMessages}
                sendMessage={sendMessage}
                vote={
                  votes
                    ? votes.find((vote) => vote.messageId === message.id)
                    : undefined
                }
              />
            );
          })}

          {/* ✅ 关键修复：仅在等待agent回复时显示思考消息，且确保流式回复消息已存在时不显示
              思考消息的显示条件：
              1. 状态是 submitted（等待回复）
              2. 不是用户-用户通信
              3. 最后一条消息不是 assistant 消息（避免与流式回复消息重复显示）
          */}
          {status === "submitted" && 
           !selectedModelId.startsWith("user::") && 
           uniqueMessages.length > 0 &&
           uniqueMessages[uniqueMessages.length - 1]?.role !== "assistant" && (
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
