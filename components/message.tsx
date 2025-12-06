"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { useSession } from "next-auth/react";
import { memo, useState, useRef } from "react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import {
  getAvatarInfo,
  isAgentMessage,
  isRemoteUserMessage,
} from "@/lib/avatar-utils";
import { useChatModels } from "@/lib/ai/models-client";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { BotIcon, UserIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  selectedModelId,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  selectedModelId?: string;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const { data: session } = useSession();
  
  // 缓存消息parts的提取结果，避免重复操作
  const messageParts = message.parts || [];
  const attachmentsFromMessage = messageParts.filter(
    (part) => part.type === "file"
  );
  const hasTextParts = messageParts.some(
    (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
  );

  useDataStream();

  // 获取metadata（缓存，避免重复访问）
  const metadata = message.metadata || {};
  
  // 判断是否为Agent消息
  // 注意：在流式传输过程中，metadata可能为空，此时需要根据selectedModelId判断
  // 如果selectedModelId存在且不是user::开头，则认为是Agent消息
  const isAgent = isAgentMessage(message.role, metadata.communicationType) ||
    (message.role === "assistant" && !metadata.communicationType && selectedModelId && !selectedModelId.startsWith("user::"));
  const isRemoteUser = isRemoteUserMessage(message.role, metadata.communicationType);
  const isLocalUser = message.role === "user";
  
  // 判断是否需要从chatModels查找名称（仅在metadata中没有名称时）
  // 新消息：metadata已固化，包含准确的名称
  // 旧消息：可能没有metadata.senderName，需要从chatModels查找作为兜底
  const needsChatModelsLookup = !isLocalUser && !metadata.senderName && !metadata.agentUsed;
  const isLoggedIn = session?.user?.type === "regular";
  // Hooks必须在顶层调用，但可以通过参数控制是否实际加载
  const { models: chatModels } = useChatModels(needsChatModelsLookup && isLoggedIn);
  
  // 获取准确的发送者名称
  // 优先使用metadata（新消息已固化），如果metadata中没有则从chatModels查找（兼容旧消息）
  // 在流式传输过程中，如果metadata为空，使用selectedModelId作为临时名称
  let senderName: string;
  if (isLocalUser) {
    // 本地用户：优先使用metadata，其次从session获取
    senderName = metadata.senderName || session?.user?.email?.split("@")[0] || "我";
  } else {
    // Assistant消息：可能是Agent或远端用户
    // 注意：对于Assistant消息，必须通过communicationType区分Agent和远端用户
    // 但在流式传输过程中，如果metadata为空，使用selectedModelId判断
    if (isAgent) {
      // Agent消息：优先使用metadata.senderName（已固化），其次使用agentUsed
      senderName = metadata.senderName || metadata.agentUsed;
      
      // 如果metadata中没有名称，从chatModels查找（兼容旧消息或查询失败的情况）
      if (!senderName && needsChatModelsLookup && chatModels.length > 0) {
        const senderId = metadata.senderId;
        const agentUsed = metadata.agentUsed;
        
        const foundAgent = chatModels.find(
          (m) => m.type === "agent" && (
            m.id === senderId || 
            m.id === agentUsed ||
            m.name === agentUsed
          )
        );
        senderName = foundAgent?.name || agentUsed;
      }
      
      // 流式传输过程中，如果 metadata 为空，优先使用 selectedModelId（发送消息时选中的 agent）
      // 这样可以避免显示"智能体"，而是显示实际的 agent ID（如"司仪"）
      // 这是接收阶段的临时名称显示，用于在 data-appendMessage 到达之前显示正确的名称
      if (!senderName) {
        senderName = selectedModelId || "智能体";
      }
    } else if (isRemoteUser) {
      // 远端用户消息：优先使用metadata.senderName
      senderName = metadata.senderName;
      
      // 如果metadata中没有名称，从chatModels查找
      if (!senderName && needsChatModelsLookup && chatModels.length > 0) {
        const senderId = metadata.senderId;
        const foundUser = chatModels.find(
          (m) => m.type === "user" && (
            m.id === senderId || 
            m.name === metadata.senderName
          )
        );
        senderName = foundUser?.name || "用户";
      }
      
      // 如果还是没有名称，使用默认值
      if (!senderName) {
        senderName = "用户";
      }
    } else {
      // 其他情况（可能是metadata为空时的assistant消息）
      // 在流式传输过程中，如果metadata为空，使用selectedModelId作为临时名称
      senderName = metadata.senderName || metadata.agentUsed || selectedModelId || "智能体";
    }
  }
  
  // 使用缓存的metadata，避免重复访问
  const receiverName = metadata.receiverName;
  const communicationType = metadata.communicationType;
  
  // 获取头像信息（固化：使用消息的senderId或senderName作为种子）
  const avatarSeed = isLocalUser 
    ? (session?.user?.memberId || session?.user?.email || session?.user?.id || "user")
    : (metadata.senderId || senderName);
  
  // 获取头像信息（包含图标变体）
  const avatarInfo = getAvatarInfo(
    senderName,
    avatarSeed,
    isAgent && !isRemoteUser
  );
  
  // 是否需要显示等待效果（仅agent需要）
  const showThinking = isAgent && isLoading;

  // 渲染消息内容
  const renderMessageContent = () => {
    // 用户消息总是显示，即使内容为空（可能是正在编辑或发送中）
    if (isLocalUser) {
      // 检查是否有有效内容
      const hasValidText = messageParts.some(
        (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
      );
      const hasAttachments = attachmentsFromMessage.length > 0;
      const hasOtherContent = messageParts.some(
        (p) => p.type !== "text" && p.type !== "file"
      );
      const hasValidContent = hasValidText || hasAttachments || hasOtherContent;
      
      // 用户消息即使内容为空也显示（可能是正在发送）
      if (!hasValidContent) {
        // 返回一个占位符，确保消息可见
        return <div className="text-gray-400 italic">（空消息）</div>;
      }
    } else {
      // Assistant 消息：检查是否有有效内容
      const hasValidText = messageParts.some(
        (p) => p.type === "text" && (p as any).text && (p as any).text.trim().length > 0
      );
      const hasAttachments = attachmentsFromMessage.length > 0;
      const hasOtherContent = messageParts.some(
        (p) => p.type !== "text" && p.type !== "file"
      );
      const hasValidContent = hasValidText || hasAttachments || hasOtherContent;
      
      if (!hasValidContent) {
        return null;
      }
    }
    
    return (
      <>
        {attachmentsFromMessage.length > 0 && (
          <div
            className={cn("flex flex-row gap-2", {
              "justify-end": isLocalUser,
              "justify-start": !isLocalUser,
            })}
            data-testid={"message-attachments"}
          >
            {attachmentsFromMessage.map((attachment) => (
              <PreviewAttachment
                attachment={{
                  name: attachment.filename ?? "file",
                  contentType: attachment.mediaType,
                  url: attachment.url,
                }}
                key={attachment.url}
              />
            ))}
          </div>
        )}

        {messageParts.map((part, index) => {
        const { type } = part;
        const key = `message-${message.id}-part-${index}`;

        if (type === "reasoning" && (part as any).text?.trim().length > 0) {
          return (
            <MessageReasoning
              isLoading={isLoading}
              key={key}
              reasoning={(part as any).text}
            />
          );
        }

        if (type === "text") {
          if (mode === "view") {
            const textContent = (part as any).text || (part as any).content || "";

            if (!textContent || textContent.trim().length === 0) {
              return null;
            }

            // 构建要渲染的文本内容
            // 对于用户消息，显示 @receiverName（接收方是 Agent 或远端用户）
            // 对于 assistant 消息（Agent 或远端用户），收信方都是右侧本地用户，因此不添加@xxx
            let displayText = sanitizeText(textContent);
            if (receiverName && isLocalUser) {
              // 用户消息：显示 @receiverName（接收方是 Agent 或远端用户）
              displayText = `@${receiverName} ${displayText}`;
            }
            // 左侧消息（Agent 或远端用户）不添加@xxx，因为收信方都是右侧本地用户

            return (
              <div key={key}>
                <MessageContent
                  className={cn({
                    "w-fit break-words rounded-2xl px-3 py-2 text-right text-white ml-auto":
                      isLocalUser,
                    "bg-transparent px-0 py-0 text-left":
                      !isLocalUser,
                  })}
                  data-testid="message-content"
                  style={
                    isLocalUser
                      ? { backgroundColor: "#006cff" }
                      : undefined
                  }
                >
                  <Response>{displayText}</Response>
                </MessageContent>
              </div>
            );
          }

          if (mode === "edit") {
            return (
              <MessageEditor
                key={message.id}
                message={message}
                regenerate={regenerate}
                setMessages={setMessages}
                setMode={setMode}
              />
            );
          }
        }

        if (type === "tool-getWeather") {
          const { toolCallId, state } = part;

          return (
            <Tool defaultOpen={true} key={toolCallId}>
              <ToolHeader state={state} type="tool-getWeather" />
              <ToolContent>
                {state === "input-available" && (
                  <ToolInput input={part.input} />
                )}
                {state === "output-available" && (
                  <ToolOutput
                    errorText={undefined}
                    output={<Weather weatherAtLocation={part.output} />}
                  />
                )}
              </ToolContent>
            </Tool>
          );
        }

        if (type === "tool-createDocument") {
          const { toolCallId } = part;

          if (part.output && "error" in part.output) {
            return (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                key={toolCallId}
              >
                创建文档时出错：{String(part.output.error)}
              </div>
            );
          }

          return (
            <DocumentPreview
              isReadonly={isReadonly}
              key={toolCallId}
              result={part.output}
            />
          );
        }

        if (type === "tool-updateDocument") {
          const { toolCallId } = part;

          if (part.output && "error" in part.output) {
            return (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                key={toolCallId}
              >
                更新文档时出错：{String(part.output.error)}
              </div>
            );
          }

          return (
            <div className="relative" key={toolCallId}>
              <DocumentPreview
                args={{ ...part.output, isUpdate: true }}
                isReadonly={isReadonly}
                result={part.output}
              />
            </div>
          );
        }

        if (type === "tool-requestSuggestions") {
          const { toolCallId, state } = part;

          return (
            <Tool defaultOpen={true} key={toolCallId}>
              <ToolHeader state={state} type="tool-requestSuggestions" />
              <ToolContent>
                {state === "input-available" && (
                  <ToolInput input={part.input} />
                )}
                {state === "output-available" && (
                  <ToolOutput
                    errorText={undefined}
                    output={
                      "error" in part.output ? (
                        <div className="rounded border p-2 text-red-500">
                          错误：{String(part.output.error)}
                        </div>
                      ) : (
                        <DocumentToolResult
                          isReadonly={isReadonly}
                          result={part.output}
                          type="request-suggestions"
                        />
                      )
                    }
                  />
                )}
              </ToolContent>
            </Tool>
          );
        }

        return null;
      })}

        {!isReadonly && (
          <MessageActions
            chatId={chatId}
            isLoading={showThinking}
            key={`action-${message.id}`}
            message={message}
            setMode={setMode}
            vote={vote}
          />
        )}
      </>
    );
  };
  
  // 如果消息内容为空，不渲染整个消息
  const messageContent = renderMessageContent();
  
  if (!messageContent) {
    // 用户消息即使内容为空也渲染（显示占位符）
    if (isLocalUser) {
      // 返回一个占位符消息，确保用户消息可见
      return (
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-800">
              <UserIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-sm text-gray-400 italic">（消息内容为空）</div>
          </div>
        </div>
      );
    }
    return null;
  }

  // 渲染头像组件（使用变体图标）
  const renderAvatar = () => (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div
        className="flex size-8 items-center justify-center rounded-full bg-white border border-blue-500"
        style={{
          color: "#3B82F6", // 蓝色前景
        }}
      >
        {avatarInfo.isAgent ? (
          <BotIcon variant={avatarInfo.iconVariant} />
        ) : (
          <UserIcon variant={avatarInfo.iconVariant} />
        )}
      </div>
      <span className="text-muted-foreground text-xs max-w-[3rem] truncate text-center">
        {senderName}
      </span>
    </div>
  );

  const messageRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={messageRef}
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      data-message-id={message.id}
      style={{
        // 确保消息可见（调试用）
        minHeight: "1px",
        opacity: 1,
        visibility: "visible" as const,
      }}
    >
      {mode === "edit" ? (
        // 编辑模式
        <div className="mx-auto flex w-full max-w-4xl items-start gap-3 px-2 md:px-4">
          <div className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            {messageContent}
          </div>
        </div>
      ) : isLocalUser ? (
        // 右侧用户消息：消息区域右对齐，头像在消息区域外侧
        <div className="mx-auto flex w-full max-w-4xl items-start justify-end">
          <div className="flex items-start gap-2 md:gap-3 px-2 md:px-4">
            <div
              className={cn("flex flex-col items-end min-w-0", {
                "gap-2 md:gap-4": hasTextParts,
                "max-w-[min(fit-content,80%)]": true,
              })}
            >
              {messageContent}
            </div>
            <div className="shrink-0">{renderAvatar()}</div>
          </div>
        </div>
      ) : (
        // 左侧消息（agent/远端用户）：消息区域左对齐，头像在消息区域外侧
        <div className="mx-auto flex w-full max-w-4xl items-start justify-start">
          <div className="flex items-start gap-2 md:gap-3 px-2 md:px-4">
            <div className="shrink-0">{renderAvatar()}</div>
            <div
              className={cn("flex flex-col flex-1 min-w-0", {
                "gap-2 md:gap-4": hasTextParts,
                "w-full": message.role === "assistant" && hasTextParts,
              })}
            >
              {messageContent}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    // 如果消息 ID 不同，需要重新渲染
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    
    // 如果 isLoading 状态变化，需要重新渲染
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    
    // 如果 requiresScrollPadding 变化，需要重新渲染
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    
    // 如果消息内容（parts）变化，需要重新渲染
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    
    // 如果 vote 变化，需要重新渲染
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    
    // 如果 selectedModelId 变化，可能影响发送者名称显示，需要重新渲染
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    
    // 其他情况：消息 ID、内容、状态都相同，可以复用组件（返回 true 表示相等，不需要重新渲染）
    return true;
  }
);

export const ThinkingMessage = ({
  agentName,
  selectedModelId,
}: {
  agentName?: string;
  selectedModelId?: string;
}) => {
  const displayAgentName = agentName || selectedModelId || "智能体";
  const avatarInfo = getAvatarInfo(displayAgentName, selectedModelId || displayAgentName, true);

  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="mx-auto flex w-full max-w-4xl items-start justify-start">
        <div className="flex items-start gap-2 md:gap-3 px-2 md:px-4">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div
              className="flex size-8 items-center justify-center rounded-full bg-white border border-blue-500 animate-pulse"
              style={{
                color: "#3B82F6",
              }}
            >
              <BotIcon variant={avatarInfo.iconVariant} />
            </div>
            <span className="text-muted-foreground text-xs max-w-[3rem] truncate text-center">
              {displayAgentName}
            </span>
          </div>

          <div className="flex w-full flex-col gap-2 md:gap-4">
            <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
              <span className="animate-pulse">思考中</span>
              <span className="inline-flex">
                <span className="animate-bounce [animation-delay:0ms]">.</span>
                <span className="animate-bounce [animation-delay:150ms]">.</span>
                <span className="animate-bounce [animation-delay:300ms]">.</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
