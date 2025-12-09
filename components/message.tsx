"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { useSession } from "next-auth/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useUserStatus } from "@/hooks/use-user-status";
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
import { UnifiedAvatar } from "./unified-avatar";
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
  sendMessage,
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
  sendMessage?: (message: ChatMessage) => void;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  
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
  const isAgent = isAgentMessage(message.role, (metadata as any).communicationType) ||
    (message.role === "assistant" && !(metadata as any).communicationType && selectedModelId && !selectedModelId.startsWith("user::"));
  const isRemoteUser = isRemoteUserMessage(message.role, (metadata as any).communicationType);
  const isLocalUser = message.role === "user";
  const senderIdForStatus = useMemo(() => {
    const senderId = (metadata as any).senderId as string | undefined;
    if (senderId) return senderId;
    if (isRemoteUser) return (metadata as any).sender_name;
    if (isLocalUser) return session?.user?.memberId || session?.user?.email?.split("@")[0];
    return undefined;
  }, [metadata, isRemoteUser, isLocalUser, session]);

  // 用户在线状态（用于头像指示）
  const [statusVersion, setStatusVersion] = useState(0);
  const { fetchUserStatus, handleStatusUpdate, getCachedStatus } = useUserStatus({
    isLoggedIn: Boolean(isLoggedIn),
    onStatusUpdate: useCallback(() => {
      setStatusVersion((prev) => prev + 1);
    }, []),
  });

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchUserStatus().then((updates) => {
      if (updates.size > 0) {
        handleStatusUpdate(updates);
      }
    });
  }, [fetchUserStatus, handleStatusUpdate, isLoggedIn]);

  useEffect(() => {
    const handleUserStatusUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ member_id?: string; is_online?: boolean }>;
      const { member_id, is_online } = customEvent.detail || {};
      if (!member_id || typeof is_online !== "boolean") {
        return;
      }
      const updates = new Map<string, boolean>();
      updates.set(member_id, is_online);
      updates.set(`user::${member_id}`, is_online);
      handleStatusUpdate(updates);
    };

    window.addEventListener("sse_user_status_update", handleUserStatusUpdate);
    return () => {
      window.removeEventListener("sse_user_status_update", handleUserStatusUpdate);
    };
  }, [handleStatusUpdate]);
  
  // 判断是否需要从chatModels查找名称（仅在metadata中没有名称时）
  // 新消息：metadata已固化，包含准确的名称
  // 旧消息：可能没有metadata.senderName，需要从chatModels查找作为兜底
  // 注意：对于Agent消息，即使metadata中有agentUsed（agent_id），也需要从chatModels查找显示名称
  const needsChatModelsLookup = !isLocalUser && (!(metadata as any).senderName || (isAgent && (metadata as any).agentUsed && !(metadata as any).senderName));
  // Hooks必须在顶层调用，但可以通过参数控制是否实际加载
  // 对于Agent消息，即使访客用户也需要加载chatModels以查找agent显示名称
  // 注意：访客用户也需要加载chatModels以查找agent显示名称，但不包含用户列表
  const { models: chatModels } = useChatModels(false); // 总是加载agents列表，但不包含用户列表
  
  // 获取准确的发送者名称
  // 优先使用metadata（新消息已固化），如果metadata中没有则从chatModels查找（兼容旧消息）
  // 在流式传输过程中，如果metadata为空，使用selectedModelId作为临时名称
  let senderName: string;
  if (isLocalUser) {
    // 本地用户：优先使用metadata，其次从session获取
    // 访客用户显示中文"访客"，登录用户显示memberId或email前缀
    if (session?.user?.type === "guest") {
      senderName = (metadata as any).senderName || "访客";
    } else {
      senderName = (metadata as any).senderName || session?.user?.email?.split("@")[0] || "我";
    }
  } else {
    // Assistant消息：可能是Agent或远端用户
    // 注意：对于Assistant消息，必须通过communicationType区分Agent和远端用户
    // 但在流式传输过程中，如果metadata为空，使用selectedModelId判断
    if (isAgent) {
      // Agent消息：优先使用metadata.senderName（已固化，应该是显示名称）
      senderName = (metadata as any).senderName || "";
      
      // 如果metadata中没有senderName，但有agentUsed（agent_id），从chatModels查找显示名称
      if (!senderName && (metadata as any).agentUsed && chatModels.length > 0) {
        const agentUsed = (metadata as any).agentUsed; // agent_id（如 "chat"）
        const foundAgent = chatModels.find(
          (m) => m.type === "agent" && m.id === agentUsed
        );
        senderName = foundAgent?.name || ""; // 使用显示名称（如 "司仪"）
      }
      
      // 如果还是没有找到，尝试使用senderId查找
      if (!senderName && (metadata as any).senderId && chatModels.length > 0) {
        const senderId = (metadata as any).senderId;
        const foundAgent = chatModels.find(
          (m) => m.type === "agent" && m.id === senderId
        );
        senderName = foundAgent?.name || "";
      }
      
      // 流式传输过程中，如果 metadata 为空，使用 selectedModelId 从 chatModels 查找显示名称
      if (!senderName && selectedModelId && chatModels.length > 0) {
        const foundAgent = chatModels.find(
          (m) => m.type === "agent" && m.id === selectedModelId
        );
        senderName = foundAgent?.name || "";
      }
      
      // 最后的兜底：如果都找不到，使用默认值（不应该发生）
      if (!senderName) {
        senderName = (metadata as any).agentUsed || selectedModelId || "智能体";
      }
    } else if (isRemoteUser) {
      // 远端用户消息：优先使用metadata.senderName
      senderName = (metadata as any).senderName || "";
      
      // 如果metadata中没有名称，从chatModels查找
      if (!senderName && needsChatModelsLookup && chatModels.length > 0) {
        const senderId = (metadata as any).senderId;
        const foundUser = chatModels.find(
          (m) => m.type === "user" && (
            m.id === senderId || 
            m.name === (metadata as any).senderName
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
      senderName = (metadata as any).senderName || (metadata as any).agentUsed || selectedModelId || "智能体";
    }
  }
  
  // 使用缓存的metadata，避免重复访问
  const communicationType = (metadata as any).communicationType;
  
  // 获取接收方名称：优先使用 metadata.receiverName，如果为空则从其他来源获取
  let receiverName = (metadata as any).receiverName;
  
  // 对于用户消息，如果 metadata 中没有 receiverName，尝试从 selectedModelId 获取
  // 这确保在 data-appendMessage 事件处理之前，用户消息也能显示 @xxx 前缀
  // 但是，如果是分享消息（用户-用户消息），不要从 selectedModelId 获取，只使用 metadata.receiverName
  const isSharedMessage = Boolean((metadata as any).isSharedMessage);

  // 用户-用户直发：补齐收件人名称，优先使用 metadata，其次使用 receiverId（去掉 user:: 前缀）
  if (
    isLocalUser &&
    communicationType === "user_user" &&
    !receiverName
  ) {
    const receiverId = (metadata as any).receiverId as string | undefined;
    receiverName = receiverId?.replace(/^user::/, "") || receiverName;
  }

  if (isLocalUser && !receiverName && !isSharedMessage && selectedModelId && !selectedModelId.startsWith("user::")) {
    // 用户消息且是 user_agent 类型：从 chatModels 查找 Agent 显示名称
    if (chatModels.length > 0) {
      const foundAgent = chatModels.find(
        (m) => m.type === "agent" && m.id === selectedModelId
      );
      receiverName = foundAgent?.name || selectedModelId;
    } else {
      receiverName = selectedModelId;
    }
  }
  
  // ✅ 最佳实践：直接使用后端传递的可靠数据，减少前端逻辑判断
  // 后端在流式响应开始时通过 metadata 事件传递 agent_id（metadata.agentUsed）
  // 前端应该直接使用后端传递的 agent_id，确保与思考消息一致
  // 思考消息使用 selectedModelId（agent_id），流式回复消息使用 metadata.agentUsed（也是 agent_id）
  // 两者应该一致，因为都来自同一个 selectedChatModel
  let avatarSeed: string;
  if (isAgent) {
    // Agent 消息：优先使用后端传递的 agent_id（metadata.agentUsed），确保与思考消息一致
    // 后端保证 metadata.agentUsed 与请求中的 agent_id 一致
    avatarSeed = (metadata as any).agentUsed || (metadata as any).senderId || selectedModelId || "default";
  } else {
    // 用户消息或其他：使用 senderId 或 senderName
    avatarSeed = (metadata as any).senderId || senderName || "default";
  }
  
  // 获取头像信息（包含图标变体）
  const avatarInfo = getAvatarInfo(
    senderName,
    avatarSeed,
    !!(isAgent && !isRemoteUser)
  );

  // 在线状态指示（仅用户头像展示）
  const userOnlineStatus = useMemo(() => {
    if (isAgent) return undefined;
    if (!senderIdForStatus) return undefined;
    return getCachedStatus(senderIdForStatus) ?? getCachedStatus(`user::${senderIdForStatus}`);
  }, [getCachedStatus, senderIdForStatus, isAgent, statusVersion]);
  
  // 是否需要显示等待效果（仅agent需要）
  const showThinking = !!(isAgent && isLoading);

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
            {attachmentsFromMessage.map((attachment, index) => {
              // 支持多种文件附件格式：
              // 1. 直接格式：{type: "file", url, name, mediaType, size, fileId}
              // 2. 嵌套格式：{type: "file", file: {file_id, filename, download_url, size}}
              const fileObj = (attachment as any).file || attachment;
              const fileUrl = fileObj.url || fileObj.download_url || attachment.url || "";
              const fileName = fileObj.filename || fileObj.name || attachment.name || attachment.filename || "file";
              const fileSize = fileObj.size || attachment.size;
              const fileId = fileObj.fileId || fileObj.file_id || attachment.fileId || attachment.file_id;
              const contentType = fileObj.mediaType || fileObj.file_type || attachment.mediaType || attachment.file_type;
              
              return (
                <PreviewAttachment
                  key={fileUrl || fileId || `${fileName}-${index}`}
                  attachment={{
                    name: fileName,
                    contentType: contentType,
                    url: fileUrl,
                    size: fileSize,
                    fileId: fileId,
                  }}
                  isInMessage={true}
                  onDownload={() => {
                    // 下载文件：用户-用户模式直接下载，用户-Agent模式也支持下载
                    if (fileUrl) {
                      const link = document.createElement("a");
                      link.href = fileUrl;
                      link.download = fileName;
                      link.target = "_blank";
                      link.rel = "noopener noreferrer"; // 安全属性
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    } else {
                      // 如果没有URL，尝试通过fileId下载
                      if (fileId) {
                        const downloadUrl = `/api/files/download/${fileId}`;
                        const link = document.createElement("a");
                        link.href = downloadUrl;
                        link.download = fileName;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }
                    }
                  }}
                />
              );
            })}
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
            // 但是，如果是分享消息（用户-用户消息），文本内容已经包含了 @xxx，不再添加
            let displayText = sanitizeText(textContent);
            const isSharedMessage = Boolean((metadata as any).isSharedMessage);
            if (receiverName && isLocalUser && !isSharedMessage) {
              // 用户消息（非分享消息）：显示 @receiverName（接收方是 Agent 或远端用户）
              displayText = `@${receiverName} ${displayText}`;
            }
            // 左侧消息（Agent 或远端用户）不添加@xxx，因为收信方都是右侧本地用户
            // 分享消息（用户-用户消息）不添加@xxx，因为文本内容已经包含了 @转发对象用户名

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
                  <Response isStreaming={isLoading}>{displayText}</Response>
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
            setMessages={setMessages}
            sendMessage={sendMessage}
            selectedModelId={selectedModelId}
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
              <UserIcon variant={0} />
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

  // 渲染头像组件（使用统一头像组件）
  // 注意：本地用户不显示在线状态（因为本地用户必然已登录）
  const renderAvatar = () => (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <UnifiedAvatar
        name={senderName}
        id={avatarSeed}
        isAgent={avatarInfo.isAgent}
        size={8}
        showStatus={!avatarInfo.isAgent && !isLocalUser}
        isOnline={userOnlineStatus}
      />
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
    // ===== 关键修复：优化 memo 比较函数，确保所有影响渲染的属性都被比较 =====
    
    // 1. 消息 ID 不同，需要重新渲染（不同消息）
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    
    // 2. 消息内容（parts）变化，需要重新渲染
    // 使用深度比较，确保内容变化时重新渲染
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    
    // 3. 消息 metadata 变化，需要重新渲染
    // 关键：metadata 包含 senderName、agentUsed 等，影响发送者名称显示
    // 在流式传输过程中，metadata 会通过 data-appendMessage 更新
    if (!equal(prevProps.message.metadata, nextProps.message.metadata)) {
      return false;
    }
    
    // 4. isLoading 状态变化，需要重新渲染（影响加载状态显示）
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    
    // 5. requiresScrollPadding 变化，需要重新渲染（影响滚动行为）
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) {
      return false;
    }
    
    // 6. vote 变化，需要重新渲染（影响投票按钮状态）
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    
    // 7. selectedModelId 变化，可能影响发送者名称显示，需要重新渲染
    // 在流式传输过程中，如果 metadata 为空，会使用 selectedModelId 作为临时名称
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    
    // 8. isReadonly 变化，需要重新渲染（影响编辑功能）
    if (prevProps.isReadonly !== nextProps.isReadonly) {
      return false;
    }
    
    // 所有关键属性都相同，可以复用组件（返回 true 表示相等，不需要重新渲染）
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
  // 获取 chatModels 以查找 agent 的显示名称
  const { models: chatModels } = useChatModels(false); // 总是加载 agents 列表，但不包含用户列表
  
  // 优先使用传入的 agentName（如果已经是显示名称）
  // 否则从 chatModels 查找 selectedModelId 对应的显示名称
  let displayAgentName = agentName || "";
  
  // 如果 agentName 不存在或等于 selectedModelId（可能是 agent_id），从 chatModels 查找显示名称
  if (!displayAgentName || displayAgentName === selectedModelId) {
    if (selectedModelId && chatModels.length > 0) {
      const foundAgent = chatModels.find(
        (m) => m.type === "agent" && m.id === selectedModelId
      );
      displayAgentName = foundAgent?.name || selectedModelId || "智能体";
    } else {
      displayAgentName = selectedModelId || "智能体";
    }
  }
  
  // ✅ 最佳实践：思考消息使用 selectedModelId（agent_id），与流式回复消息的 metadata.agentUsed 一致
  // 后端保证在流式响应开始时通过 metadata 事件传递 agent_id（metadata.agentUsed）
  // 这个 agent_id 与请求中的 selectedChatModel（即 selectedModelId）一致
  // 因此思考消息和流式回复消息使用相同的 agent_id，头像自然一致
  const avatarSeed = selectedModelId || displayAgentName;
  
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="mx-auto flex w-full max-w-4xl items-start justify-start">
        <div className="flex items-start gap-2 md:gap-3 px-2 md:px-4">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="animate-pulse">
              <UnifiedAvatar
                name={displayAgentName}
                id={avatarSeed} // ✅ 使用 avatarSeed 确保与流式回复消息一致
                isAgent={true}
                size={32}
              />
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
