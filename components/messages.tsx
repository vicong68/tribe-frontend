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
    // 详细日志：追踪消息过滤
    if (process.env.NODE_ENV === "development") {
      console.log("[uniqueMessages] ===== 消息去重和过滤 =====");
      console.log("[uniqueMessages] 输入消息数量:", messages.length);
      console.log("[uniqueMessages] 输入消息:", messages.map(m => ({ id: m.id, role: m.role, partsCount: m.parts?.length || 0 })));
    }
    
    const seen = new Map<string, ChatMessage>();
    for (const message of messages) {
      seen.set(message.id, message);
    }
    const result = Array.from(seen.values());
    
    // 详细日志：去重后
    if (process.env.NODE_ENV === "development") {
      console.log("[uniqueMessages] 去重后消息数量:", result.length);
      console.log("[uniqueMessages] 去重后消息:", result.map(m => ({ id: m.id, role: m.role })));
    }
    
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
        (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
      );
      // 检查是否有文件附件
      const hasAttachments = parts.some((p) => p.type === "file");
      // 检查是否有其他有效内容（reasoning、tool 等）
      const hasOtherContent = parts.some(
        (p) => p.type !== "text" && p.type !== "file"
      );
      
      const shouldKeep = hasValidText || hasAttachments || hasOtherContent;
      
      // 详细日志：被过滤的消息
      if (process.env.NODE_ENV === "development" && !shouldKeep) {
        console.warn("[uniqueMessages] ⚠️ 过滤掉空消息:", { 
          id: message.id, 
          role: message.role, 
          parts,
          hasValidText,
          hasAttachments,
          hasOtherContent
        });
      }
      
      return shouldKeep;
    });
    
    // 详细日志：最终结果
    if (process.env.NODE_ENV === "development") {
      console.log("[uniqueMessages] 过滤后消息数量:", filteredMessages.length);
      console.log("[uniqueMessages] 过滤后消息:", filteredMessages.map(m => ({ id: m.id, role: m.role })));
      
      // 检查是否有用户消息被过滤
      const inputUserMessages = messages.filter(m => m.role === "user");
      const outputUserMessages = filteredMessages.filter(m => m.role === "user");
      if (inputUserMessages.length !== outputUserMessages.length) {
        console.error("[uniqueMessages] ❌ 错误：用户消息被过滤！", {
          input: inputUserMessages.map(m => ({ id: m.id, parts: m.parts })),
          output: outputUserMessages.map(m => ({ id: m.id, parts: m.parts }))
        });
      }
      
      // 检查最后一条用户消息是否在输出中
      const lastInputUserMessage = inputUserMessages[inputUserMessages.length - 1];
      if (lastInputUserMessage) {
        const lastUserMessageInOutput = outputUserMessages.find(m => m.id === lastInputUserMessage.id);
        if (!lastUserMessageInOutput) {
          console.error("[uniqueMessages] ❌ 错误：最后一条用户消息不在输出中！", {
            id: lastInputUserMessage.id,
            parts: lastInputUserMessage.parts,
            hasValidText: lastInputUserMessage.parts?.some(
              (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
            ),
            hasAttachments: lastInputUserMessage.parts?.some((p) => p.type === "file"),
          });
        } else {
          // 详细日志：确认最后一条用户消息在输出中
          const indexInFilteredMessages = filteredMessages.findIndex(m => m.id === lastInputUserMessage.id);
          console.log("[uniqueMessages] ✅ 最后一条用户消息在输出中:", {
            id: lastInputUserMessage.id,
            indexInInput: messages.findIndex(m => m.id === lastInputUserMessage.id),
            indexInFilteredMessages: indexInFilteredMessages,
            indexInOutputUserMessages: outputUserMessages.findIndex(m => m.id === lastInputUserMessage.id),
            totalInputMessages: messages.length,
            totalOutputMessages: filteredMessages.length,
            isLastMessage: indexInFilteredMessages === filteredMessages.length - 1,
            messagesAfterLastUser: filteredMessages.slice(indexInFilteredMessages + 1).map(m => ({ id: m.id, role: m.role })),
          });
        }
      }
      
      // 详细日志：显示过滤后的最后几条消息
      if (process.env.NODE_ENV === "development") {
        const lastFewMessages = filteredMessages.slice(-5);
        console.log("[uniqueMessages] 过滤后的最后 5 条消息:", lastFewMessages.map((m, idx) => ({ 
          id: m.id, 
          role: m.role,
          index: filteredMessages.length - 5 + idx,
          isLastUserMessage: m.id === lastInputUserMessage?.id
        })));
      }
    }
    
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
            console.warn("[Messages] ⚠️ 流式传输时，最后一条用户消息不在视口中，滚动到消息位置");
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

  // 追踪滚动位置和消息可见性
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const lastUserMessage = uniqueMessages.filter(m => m.role === "user").slice(-1)[0];
      
      if (lastUserMessage) {
        // 使用 setTimeout 确保 DOM 已更新
        setTimeout(() => {
          const messageElement = container.querySelector(`[data-message-id="${lastUserMessage.id}"]`);
          if (messageElement) {
            const rect = messageElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            // 修正视口判断：消息在容器视口内（考虑容器的位置）
            const isInViewport = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 100;
            
            // 计算消息相对于容器的位置
            const messageTopRelativeToContainer = rect.top - containerRect.top + scrollTop;
            const messageBottomRelativeToContainer = rect.bottom - containerRect.top + scrollTop;
            
            console.log("[Messages] 滚动位置和消息可见性:", {
              lastUserMessageId: lastUserMessage.id,
              isVisible,
              isInViewport,
              scrollTop,
              scrollHeight,
              clientHeight,
              isAtBottom,
              messageTopRelativeToContainer,
              messageBottomRelativeToContainer,
              messageRect: {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
                width: rect.width,
              },
              containerRect: {
                top: containerRect.top,
                bottom: containerRect.bottom,
                height: containerRect.height,
                width: containerRect.width,
              },
              // 如果消息不在视口中，计算需要滚动多少
              needsScroll: !isInViewport ? {
                scrollToTop: messageTopRelativeToContainer - scrollTop,
                scrollToBottom: messageBottomRelativeToContainer - (scrollTop + clientHeight),
              } : null,
            });
            
            // 如果消息不在视口中，尝试滚动到消息位置
            if (!isInViewport) {
              console.warn("[Messages] ⚠️ 最后一条用户消息不在视口中！", {
                messageTop: rect.top,
                messageBottom: rect.bottom,
                containerTop: containerRect.top,
                containerBottom: containerRect.bottom,
                scrollTop,
                scrollHeight,
                clientHeight,
              });
              
              // 如果容器在底部，但消息不在视口中，说明消息在底部之前
              // 尝试滚动到消息位置，确保消息可见
              if (isAtBottom) {
                console.warn("[Messages] ⚠️ 容器在底部，但消息不在视口中！尝试滚动到消息位置");
                // 计算消息相对于容器的位置
                const messageTopRelativeToContainer = rect.top - containerRect.top + scrollTop;
                // 滚动到消息位置，留出一些边距（居中显示）
                const targetScrollTop = messageTopRelativeToContainer - containerRect.height / 2;
                container.scrollTo({
                  top: Math.max(0, targetScrollTop),
                  behavior: "smooth",
                });
              } else {
                // 如果不在底部，可能是用户手动滚动了，不自动滚动
                console.log("[Messages] 用户不在底部，不自动滚动");
              }
            }
          } else {
            console.warn("[Messages] ⚠️ 最后一条用户消息的 DOM 元素未找到:", lastUserMessage.id);
          }
        }, 100);
      }
    }
  }, [uniqueMessages, messagesContainerRef]);

  return (
    <div className="relative flex-1">
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto"
        ref={messagesContainerRef}
      >
        <div className="flex min-w-0 flex-col gap-4 py-4 md:gap-6">
          {uniqueMessages.length === 0 && <Greeting />}

          {uniqueMessages.map((message, index) => {
            // 详细日志：追踪每条消息的渲染（仅最后几条）
            if (process.env.NODE_ENV === "development" && index >= uniqueMessages.length - 3) {
              console.log("[Messages] 渲染消息:", {
                id: message.id,
                role: message.role,
                index,
                totalMessages: uniqueMessages.length,
                isLastMessage: index === uniqueMessages.length - 1,
              });
            }
            
            // 详细日志：追踪最后一条用户消息的渲染
            const isLastUserMessage = message.role === "user" && 
              uniqueMessages.slice(index + 1).every(m => m.role !== "user");
            
            if (process.env.NODE_ENV === "development" && isLastUserMessage) {
              console.log("[Messages] 渲染最后一条用户消息:", {
                id: message.id,
                index,
                totalMessages: uniqueMessages.length,
                key: message.id,
                hasStableKey: true,
              });
            }
            
            return (
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
                  hasSentMessage && index === uniqueMessages.length - 1
                }
                selectedModelId={selectedModelId}
                setMessages={setMessages}
                vote={
                  votes
                    ? votes.find((vote) => vote.messageId === message.id)
                    : undefined
                }
              />
            );
          })}

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
