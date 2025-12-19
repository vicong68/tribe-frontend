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
import { useAgents, useUsers } from "@/lib/ai/models-client";
import { useDataStream } from "./data-stream-provider";
import { getMessageRenderInfo, getThinkingMessageRenderInfo } from "@/lib/message-render-utils";
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
  modelLookup,
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
  modelLookup?: Record<string, { name?: string }>;
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
  
  // ✅ 统一使用消息渲染工具函数，简化代码逻辑
  // Hooks必须在顶层调用，但可以通过参数控制是否实际加载
  // ✅ 性能优化：根据消息类型动态加载用户列表（如果是用户-用户模式）
  // 检查消息是否是用户-用户模式：包括本地用户消息和远端用户消息
  const messageCommunicationType = (metadata as any)?.communicationType;
  const isUserToUserMessage = messageCommunicationType === "user_user";
  // 检查是否是远端用户消息（assistant 角色但 communicationType 是 user_user）
  const isRemoteUserMsg = message.role === "assistant" && isUserToUserMessage;
  // ✅ 优化：即使 metadata 中没有 communicationType，也检查 receiverId 是否是用户ID
  // 如果 receiverId 是用户ID格式（包含@或 user:: 前缀），也需要加载用户列表
  const receiverId = (metadata as any)?.receiverId;
  const receiverIdIsUser = receiverId && (
    receiverId.includes("@") || 
    receiverId.startsWith("user::") ||
    !receiverId.includes("::") // 没有 :: 分隔符的可能是用户ID
  );
  // ✅ 关键修复：检查 metadata 中是否有 receiverName，如果有但看起来像ID，也需要加载用户列表
  // 这确保刷新后即使 metadata 中的 receiverName 是ID，也能正确解析为显示名称
  const metadataReceiverName = (metadata as any)?.receiverName;
  const receiverNameIsId = metadataReceiverName && (
    metadataReceiverName.includes("@") ||
    metadataReceiverName === receiverId ||
    metadataReceiverName.startsWith("user::")
  );
  // 如果消息是用户-用户模式（本地用户消息或远端用户消息），或接收者是用户，或receiverName是ID，需要加载用户列表
  const needsUserList = isUserToUserMessage || isRemoteUserMsg || (message.role === "user" && receiverIdIsUser) || (message.role === "user" && receiverNameIsId);
  const currentUserId = isLoggedIn && session?.user 
    ? (session.user.memberId || session.user.email?.split("@")[0] || session.user.id || null)
    : null;
  // 如果需要用户列表，加载用户列表以正确解析用户名称
  const { models: agents } = useAgents();
  const { models: users } = useUsers(needsUserList && isLoggedIn ? currentUserId : null, 0);
  const chatModels = useMemo(() => needsUserList && isLoggedIn ? [...agents, ...users] : agents, [agents, users, needsUserList, isLoggedIn]);
  const effectiveModelLookup = useMemo(() => {
    if (modelLookup && Object.keys(modelLookup).length > 0) {
      return modelLookup;
    }
    const lookup: Record<string, { name?: string }> = {};
    for (const model of chatModels) {
      lookup[model.id] = { name: model.name };
    }
    return lookup;
  }, [modelLookup, chatModels]);
  
  // ✅ 优化：使用 useMemo 缓存渲染信息，避免重复计算
  const renderInfo = useMemo(() => {
    return getMessageRenderInfo(
      message,
      metadata as Record<string, any> | null | undefined,
      selectedModelId,
      session,
      chatModels,
      effectiveModelLookup
    );
  }, [message, metadata, selectedModelId, session, chatModels, effectiveModelLookup]);
  
  // 从渲染信息中提取需要的变量（保持向后兼容）
  const { senderName, receiverName, avatarSeed, senderId, isAgent, isRemoteUser, isLocalUser, communicationType: renderCommunicationType } = renderInfo;
  const communicationType = renderCommunicationType;
  
  // ✅ 优化：获取发送者ID（用于在线状态），简化逻辑
  const senderIdForStatus = useMemo(() => {
    if (senderId) return senderId;
    if (isRemoteUser) return (metadata as any).sender_name;
    if (isLocalUser) return session?.user?.memberId || session?.user?.email?.split("@")[0];
    return undefined;
  }, [senderId, isRemoteUser, isLocalUser, metadata, session]);

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
  
  // 获取头像信息（包含图标变体）
  const avatarInfo = getAvatarInfo(
    senderName,
    avatarSeed,
    !!(isAgent && !isRemoteUser)
  );

  // ✅ 统一在线状态获取：与好友列表和下拉列表保持一致
  // 好友列表和下拉列表的逻辑：从 chatModels 获取用户，然后使用 getCachedStatus 更新 isOnline
  // 这里也使用相同的逻辑：优先从 chatModels 中查找用户，然后使用 getCachedStatus 获取在线状态
  const userOnlineStatus = useMemo(() => {
    if (isAgent) return undefined;
    if (!senderIdForStatus) return undefined;
    
    // 从 chatModels 中查找用户（与好友列表和下拉列表保持一致）
    const userModel = chatModels.find((model) => {
      if (model.type !== "user") return false;
      const modelId = model.id.replace(/^user::/, "");
      const modelMemberId = senderIdForStatus.replace(/^user::/, "");
      return model.id === senderIdForStatus || 
             model.id === `user::${senderIdForStatus}` ||
             modelId === senderIdForStatus ||
             modelId === modelMemberId ||
             model.id === `user::${modelMemberId}`;
    });
    
    // ✅ 关键修复：与好友列表和下拉列表保持一致，使用 getCachedStatus 获取在线状态
    // 好友列表和下拉列表的逻辑是：从 chatModels 获取用户，然后使用 getCachedStatus 更新 isOnline
    // 这里也使用相同的逻辑：如果找到用户，使用 getCachedStatus 获取在线状态（而不是直接使用 model.isOnline）
    if (userModel) {
      // 使用 getCachedStatus 获取在线状态（与好友列表和下拉列表保持一致）
      const cachedStatus = getCachedStatus(userModel.id);
      if (cachedStatus !== undefined) {
        return cachedStatus;
      }
      // 如果 getCachedStatus 返回 undefined，尝试使用 model.isOnline（可能来自后端API）
      if (typeof userModel.isOnline === "boolean") {
        return userModel.isOnline;
      }
    }
    
    // 后备方案：如果 chatModels 中没有找到，直接使用 getCachedStatus
    return getCachedStatus(senderIdForStatus) ?? getCachedStatus(`user::${senderIdForStatus}`);
  }, [chatModels, getCachedStatus, senderIdForStatus, isAgent, statusVersion]);
  
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
    
    // ✅ 检查是否有文本内容（用于判断是否需要在文件下方显示@xxx）
    const hasTextContent = messageParts.some((part) => {
      if (part.type === "text") {
        const textContent = (part as any).text || (part as any).content || "";
        return textContent && textContent.trim().length > 0;
      }
      return false;
    });
    
    // ✅ 用户-用户模式：如果只有文件没有文本，需要在文件下方显示@xxx
    const shouldShowMentionForFiles = 
      isLocalUser && 
      communicationType === "user_user" && 
      attachmentsFromMessage.length > 0 && 
      !hasTextContent && 
      receiverName;
    
    return (
      <>
        {attachmentsFromMessage.length > 0 && (
          <div
            className={cn("flex flex-col gap-2", {
              "items-end": isLocalUser,
              "items-start": !isLocalUser,
            })}
            data-testid={"message-attachments"}
          >
            <div
              className={cn("flex flex-row gap-2", {
                "justify-end": isLocalUser,
                "justify-start": !isLocalUser,
              })}
            >
              {attachmentsFromMessage.map((attachment, index) => {
                // 支持多种文件附件格式：
                // 1. 直接格式：{type: "file", url, name, mediaType, size, fileId, thumbnailUrl}
                // 2. 嵌套格式：{type: "file", file: {file_id, filename, download_url, size, thumbnail_url}}
                const fileObj = (attachment as any).file || attachment;
                const attachmentAny = attachment as any;
                const fileUrl = fileObj.url || fileObj.download_url || attachmentAny.url || "";
                // ✅ 优先使用原始文件名（filename 字段通常是原始文件名）
                const fileName = fileObj.filename || fileObj.name || attachmentAny.name || attachmentAny.filename || "file";
                const fileSize = fileObj.size || attachmentAny.size;
                const fileId = fileObj.fileId || fileObj.file_id || attachmentAny.fileId || attachmentAny.file_id;
                const contentType = fileObj.mediaType || fileObj.file_type || attachmentAny.mediaType || attachmentAny.file_type;
                // ✅ 支持缩略图URL
                const thumbnailUrl = fileObj.thumbnailUrl || fileObj.thumbnail_url || (attachment as any).thumbnailUrl;
                
                return (
                  <PreviewAttachment
                    key={fileUrl || fileId || `${fileName}-${index}`}
                    attachment={{
                      name: fileName,
                      contentType: contentType,
                      url: fileUrl,
                      size: fileSize,
                      fileId: fileId,
                      thumbnailUrl: thumbnailUrl, // ✅ 传递缩略图URL
                    }}
                    isInMessage={true}
                    onDownload={() => {
                      // 下载文件：用户-用户模式直接下载，用户-Agent模式也支持下载
                      // ✅ 下载时使用原始文件名
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
            {/* ✅ 用户-用户模式：如果只有文件没有文本，在文件下方显示@xxx */}
            {shouldShowMentionForFiles && (
              <div
                className={cn("text-sm text-foreground/70", {
                  "text-right": isLocalUser,
                  "text-left": !isLocalUser,
                })}
              >
                @{receiverName}
              </div>
            )}
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
    
    // 3.5 模型映射变化（可能带来更友好的名称），需要重新渲染
    if (prevProps.modelLookup !== nextProps.modelLookup) {
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
  modelLookup,
}: {
  agentName?: string;
  selectedModelId?: string;
  modelLookup?: Record<string, { name?: string }>;
}) => {
  // ✅ 统一使用思考消息渲染工具函数，确保与流式消息的渲染信息保持一致
  // ✅ 使用 useAgents 加载智能体列表（不包含用户列表）
  const { models: chatModels } = useAgents();
  const effectiveModelLookup = useMemo(() => {
    if (modelLookup && Object.keys(modelLookup).length > 0) {
      return modelLookup;
    }
    const lookup: Record<string, { name?: string }> = {};
    for (const model of chatModels) {
      lookup[model.id] = { name: model.name };
    }
    return lookup;
  }, [modelLookup, chatModels]);
  
  // 使用统一的思考消息渲染工具函数获取渲染信息
  const renderInfo = getThinkingMessageRenderInfo(selectedModelId, chatModels, effectiveModelLookup);
  
  // 如果传入了 agentName 且不是 agent_id，优先使用（向后兼容）
  const displayAgentName = agentName && agentName !== selectedModelId 
    ? agentName 
    : renderInfo.senderName;
  
  // 使用统一的 avatarSeed，确保与流式回复消息一致
  const avatarSeed = renderInfo.avatarSeed;
  
  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role="assistant"
      data-testid="message-assistant-loading"
      style={{
        // 确保与流式回复消息的样式完全一致
        minHeight: "1px",
        opacity: 1,
        visibility: "visible" as const,
      }}
    >
      {/* ✅ 优化：使用与流式回复消息完全相同的布局结构 */}
      <div className="mx-auto flex w-full max-w-4xl items-start justify-start">
        <div className="flex items-start gap-2 md:gap-3 px-2 md:px-4">
          {/* 头像区域：与流式回复消息完全一致 */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <UnifiedAvatar
              name={displayAgentName}
              id={avatarSeed} // ✅ 使用 avatarSeed 确保与流式回复消息一致
              isAgent={true}
              size={8} // ✅ 使用 size={8} 与流式回复消息一致（32px）
            />
            <span className="text-muted-foreground text-xs max-w-[3rem] truncate text-center">
              {displayAgentName}
            </span>
          </div>

          {/* 内容区域：与流式回复消息的布局结构一致 */}
          <div className="flex flex-col flex-1 min-w-0 gap-2 md:gap-4">
            {/* ✅ 优化：使用更平滑的思考动画，与消息内容区域样式一致 */}
            <div className="flex items-center gap-1 text-muted-foreground text-sm">
              <span className="animate-pulse">思考中</span>
              <span className="inline-flex gap-0.5">
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
