"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { Trigger } from "@radix-ui/react-select";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { saveChatModelAsCookie } from "@/app/(chat)/actions";
import { SelectItem } from "@/components/ui/select";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { useChatModels } from "@/lib/ai/models-client";
import { preloadAvatars } from "@/lib/avatar-utils";
import type { Attachment, ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { useUserStatus } from "@/hooks/use-user-status";
import { Context } from "./elements/context";
import {
  PromptInput,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./elements/prompt-input";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CpuIcon,
  PaperclipIcon,
  BotIcon,
  UserIcon,
  StopIcon,
} from "./icons";
import { UnifiedAvatar } from "./unified-avatar";
import { PreviewAttachment } from "./preview-attachment";
import { SuggestedActions } from "./suggested-actions";
import { Button } from "./ui/button";
import type { VisibilityType } from "./visibility-selector";

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  usage,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  usage?: AppUsage;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const { data: session } = useSession();
  const { models: chatModels } = useChatModels(session?.user?.type === "regular");
  
  const submitForm = useCallback(() => {
    window.history.pushState({}, "", `/chat/${chatId}`);

    // 预先构建 metadata，确保在发送消息时就有完整的 metadata
    // 这样可以避免流式响应开始时用户消息不可见的问题
    const isUserToUser = selectedModelId.startsWith("user::");
    const selectedChatModel = chatModels.find((m) => m.id === selectedModelId);
    let receiverName = selectedChatModel?.name || selectedModelId;
    if (isUserToUser && !selectedChatModel) {
      receiverName = selectedModelId.replace(/^user::/, "");
    }
    
    // 验证消息内容
    const hasText = input.trim().length > 0;
    const hasFiles = attachments.length > 0;
    
    // 用户-agent模式：如果只有文件没有文本，则不允许发送
    if (!isUserToUser && hasFiles && !hasText) {
      toast.error("用户-Agent模式下，发送文件时必须附带文本说明");
      return;
    }
    
    // 如果既没有文本也没有文件，不允许发送
    if (!hasText && !hasFiles) {
      toast.error("请输入消息内容或添加文件");
      return;
    }
    
    let tempSenderName = "我";
    if (session?.user?.type === "guest") {
      tempSenderName = "访客";
    } else if (session?.user?.email) {
      tempSenderName = session.user.email.split("@")[0];
    }
    
    const tempMetadata: Record<string, any> = {
      createdAt: new Date().toISOString(),
      senderId: session?.user?.memberId || session?.user?.email?.split("@")[0] || session?.user?.id || "guest_user",
      senderName: tempSenderName,
      receiverId: selectedModelId,
      receiverName: receiverName,
      communicationType: isUserToUser ? "user_user" : "user_agent",
    };
    
    if (!isUserToUser) {
      tempMetadata.agentUsed = selectedModelId;
    }

    // 构建消息parts
    // 用户-用户模式：支持单独发文件（如果没有文本，可以不添加text part）
    // 用户-agent模式：必须有文本（已在上面验证）
    const parts: Array<{ type: "file"; url: string; name: string; mediaType: string; size?: number; fileId?: string } | { type: "text"; text: string }> = [];
    
    // 添加文件parts
    if (hasFiles) {
      parts.push(
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
          size: attachment.size,
          fileId: attachment.fileId,
        }))
      );
    }
    
    // 添加文本part（如果有文本）
    // 用户-用户模式：如果只有文件没有文本，不添加text part（支持纯文件消息）
    // 用户-agent模式：必须有文本（已在上面验证，所以这里hasText一定为true）
    if (hasText) {
      parts.push({
        type: "text",
        text: input,
      });
    }

    // 发送消息（useChat 会立即将消息添加到 messages 列表）
    // 预先设置 metadata，确保用户消息在流式响应开始前就完全可见
    sendMessage({
      role: "user",
      parts: parts as any, // AI SDK的parts类型较复杂，使用as any避免类型错误
      metadata: tempMetadata as any, // metadata类型兼容
    });

    setAttachments([]);
    setLocalStorageInput("");
    resetHeight();
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    selectedModelId,
    chatModels,
    session,
    chatId,
    width,
    resetHeight,
    setLocalStorageInput,
    setLocalStorageInput,
    setMessages,
    width,
    chatId,
    resetHeight,
    selectedModelId,
    chatModels,
    session,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType, size, fileId } = data;

        // 验证返回数据的完整性
        if (!url) {
          throw new Error("服务器返回的文件URL为空");
        }

        return {
          url,
          name: pathname || file.name, // 优先使用后端返回的pathname，否则使用原始文件名
          contentType: contentType || file.type || "application/octet-stream",
          size: size || file.size, // 优先使用后端返回的size，否则使用file.size
          fileId: fileId || url, // 优先使用后端返回的fileId，否则使用url作为标识
        };
      }
      
      // 处理错误响应
      let errorMessage = "文件上传失败";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // 如果响应不是JSON，使用状态文本
        errorMessage = `文件上传失败 (${response.status})`;
      }
      
      throw new Error(errorMessage);
    } catch (error) {
      // 重新抛出错误，由调用者处理
      throw error;
    }
  }, []);

  const contextProps = useMemo(
    () => ({
      usage,
    }),
    [usage]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      
      if (files.length === 0) {
        return;
      }

      setUploadQueue(files.map((file) => file.name));

      try {
        // 并行上传所有文件，但分别处理成功和失败
        const uploadPromises = files.map(async (file) => {
          try {
            return await uploadFile(file);
          } catch (error) {
            // 单个文件上传失败不影响其他文件
            console.error(`[MultimodalInput] 文件上传失败: ${file.name}`, error);
            toast.error(`文件 "${file.name}" 上传失败`);
            return undefined;
          }
        });
        
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        if (successfullyUploadedAttachments.length > 0) {
          setAttachments((currentAttachments) => [
            ...currentAttachments,
            ...successfullyUploadedAttachments,
          ]);
        }
        
        // 如果有部分文件上传失败，提示用户
        if (successfullyUploadedAttachments.length < files.length) {
          const failedCount = files.length - successfullyUploadedAttachments.length;
          if (failedCount > 0) {
            toast.error(`${failedCount} 个文件上传失败`);
          }
        }
      } catch (error) {
        console.error("[MultimodalInput] 文件上传处理异常:", error);
        toast.error("文件上传处理失败，请重试");
      } finally {
        setUploadQueue([]);
        // 清空input，允许重复选择同一文件
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [setAttachments, uploadFile]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      // 支持粘贴图片和其他文件类型
      const fileItems = Array.from(items).filter((item) =>
        item.kind === "file"
      );

      if (fileItems.length === 0) {
        return;
      }

      // Prevent default paste behavior for files
      event.preventDefault();

      const fileNames = fileItems.map((item) => item.type.startsWith("image/") ? "粘贴的图片" : "粘贴的文件");
      setUploadQueue((prev) => [...prev, ...fileNames]);

      try {
        // 并行上传所有粘贴的文件
        const uploadPromises = fileItems.map(async (item) => {
          try {
            const file = item.getAsFile();
            if (!file) {
              return undefined;
            }
            return await uploadFile(file);
          } catch (error) {
            console.error(`[MultimodalInput] 粘贴文件上传失败:`, error);
            return undefined;
          }
        });

        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined
        ) as Attachment[];

        if (successfullyUploadedAttachments.length > 0) {
          setAttachments((curr) => [
            ...curr,
            ...successfullyUploadedAttachments,
          ]);
        }
        
        // 如果有部分文件上传失败，提示用户
        if (successfullyUploadedAttachments.length < fileItems.length) {
          const failedCount = fileItems.length - successfullyUploadedAttachments.length;
          if (failedCount > 0) {
            toast.error(`${failedCount} 个粘贴的文件上传失败`);
          }
        }
      } catch (error) {
        console.error("[MultimodalInput] 粘贴文件处理异常:", error);
        toast.error("粘贴文件上传失败，请重试");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  // Add paste event listener to textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}

      <input
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-border hover:border-muted-foreground/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (status !== "ready") {
            toast.error("请等待模型完成回复！");
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-auto pb-1"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="flex flex-row items-start gap-1 sm:gap-2">
          <PromptInputTextarea
            autoFocus
            className="grow resize-none border-0! border-none! bg-transparent p-2 text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            disableAutoResize={true}
            maxHeight={200}
            minHeight={44}
            onChange={handleInput}
            placeholder="发送消息..."
            ref={textareaRef}
            rows={1}
            value={input}
          />{" "}
          <Context {...contextProps} />
        </div>
        <PromptInputToolbar className="!border-top-0 border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <AttachmentsButton
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
              status={status}
            />
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              data-testid="send-button"
              disabled={(() => {
                // 如果正在上传文件，禁用按钮
                if (uploadQueue.length > 0) {
                  return true;
                }
                
                // 检查是否有内容可发送
                const hasText = input.trim().length > 0;
                const hasFiles = attachments.length > 0;
                const isUserToUser = selectedModelId.startsWith("user::");
                
                // 用户-用户模式：有文本或文件即可发送
                if (isUserToUser) {
                  return !hasText && !hasFiles;
                }
                
                // 用户-agent模式：必须有文本（即使有文件也需要文本）
                return !hasText;
              })()}
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
  status,
  selectedModelId,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  const isReasoningModel = selectedModelId === "chat-model-reasoning";

  return (
    <Button
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={status !== "ready" || isReasoningModel}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [optimisticModelId, setOptimisticModelId] = useState(selectedModelId);
  const { data: session } = useSession();
  
  const userType = session?.user?.type || "guest";
  const isLoggedIn = userType === "regular";
  const [statusVersion, setStatusVersion] = useState(0);
  
  // 从后端获取模型列表（登录用户包含用户列表）
  const { models: chatModels } = useChatModels(isLoggedIn);

  // 用户在线状态（用于统一头像在线/离线标记）
  const { fetchUserStatus, handleStatusUpdate, getCachedStatus } = useUserStatus({
    isLoggedIn,
    onStatusUpdate: useCallback(() => {
      setStatusVersion((prev) => prev + 1);
    }, []),
  });

  // 初始化时快速拉取一次在线状态
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchUserStatus().then((statusMap) => {
      if (statusMap.size > 0) {
        handleStatusUpdate(statusMap);
        setStatusVersion((prev) => prev + 1);
      }
    });
  }, [isLoggedIn, fetchUserStatus, handleStatusUpdate]);

  // 监听 SSE 用户状态更新事件，实时刷新在线状态缓存
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
      setStatusVersion((prev) => prev + 1);
    };

    window.addEventListener("sse_user_status_update", handleUserStatusUpdate);
    return () => {
      window.removeEventListener("sse_user_status_update", handleUserStatusUpdate);
    };
  }, [handleStatusUpdate]);

  // 调试日志（仅在开发环境且关键状态变化时输出，减少日志噪音）

  useEffect(() => {
    setOptimisticModelId(selectedModelId);
  }, [selectedModelId]);

  // 分离 agents 和 users
  // 统一使用好友列表的逻辑：显示所有agents（包括动态智能体），不进行权限过滤
  // 权限过滤应该在发送消息时进行，而不是在显示列表时
  const availableAgents = chatModels.filter((chatModel) => {
    return chatModel.type === "agent";
  });

  const availableUsers = chatModels.filter((chatModel) => {
    if (chatModel.type !== "user") return false;
    // 登录用户可以看到所有用户（除了自己）
    if (isLoggedIn && session?.user) {
      const currentUserId = session.user.memberId || session.user.email?.split("@")[0] || session.user.id;
      return chatModel.id !== `user::${currentUserId}`;
    }
    return false;
  });

  // 合并列表：agents 在前，users 在后
  const allModels = [...availableAgents, ...availableUsers];
  
  // 预加载所有模型的头像信息（使用 chatModels 作为依赖，避免 allModels 变化导致重复计算）
  const modelsWithAvatars = useMemo(() => {
    const withAvatars = preloadAvatars(allModels);
    return withAvatars.map((model) => {
      if (model.type !== "user") {
        return model;
      }
      const cachedStatus = getCachedStatus(model.id);
      return {
        ...model,
        isOnline: cachedStatus ?? model.isOnline,
      };
    });
  }, [allModels, getCachedStatus, statusVersion]);

  // 移除 Filtered 日志（减少日志噪音，仅在需要调试时手动添加）

  const selectedModel = modelsWithAvatars.find(
    (model) => model.id === optimisticModelId
  ) || modelsWithAvatars[0];

  // 判断选中的模型是否是当前用户（本地用户不显示状态）
  const isCurrentUser = useMemo(() => {
    if (!selectedModel || selectedModel.type !== "user" || !isLoggedIn || !session?.user) {
      return false;
    }
    const currentUserId = session.user.memberId || session.user.email?.split("@")[0] || session.user.id;
    const modelMemberId = selectedModel.id.replace(/^user::/, "");
    return modelMemberId === currentUserId;
  }, [selectedModel, isLoggedIn, session]);

  return (
    <PromptInputModelSelect
      onValueChange={(modelName) => {
        const model = allModels.find((m) => m.name === modelName);
        if (model) {
          setOptimisticModelId(model.id);
          onModelChange?.(model.id);
          startTransition(() => {
            saveChatModelAsCookie(model.id);
          });
        }
      }}
      value={selectedModel?.name}
    >
      <Trigger asChild>
        <Button className="h-8 px-2" variant="ghost">
          {selectedModel && (
            <div className="mr-1.5 shrink-0">
              <UnifiedAvatar
                name={selectedModel.name}
                id={selectedModel.id}
                isAgent={selectedModel.avatar.isAgent}
                size={5}
                showStatus={selectedModel.type === "user" && !isCurrentUser}
                isOnline={selectedModel.isOnline}
              />
            </div>
          )}
          <span className="hidden font-medium text-xs sm:block">
            {selectedModel?.name}
          </span>
          <ChevronDownIcon size={16} />
        </Button>
      </Trigger>
      <PromptInputModelSelectContent className="min-w-[240px] sm:min-w-[260px] max-h-[70vh] overflow-y-auto">
        {/* 智能体分组 */}
        {modelsWithAvatars.filter((m) => m.type === "agent").length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              智能体
            </div>
            {modelsWithAvatars
              .filter((m) => m.type === "agent")
              .map((model) => (
                <SelectItem key={model.id} value={model.name}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UnifiedAvatar
                      name={model.name}
                      id={model.id}
                      isAgent={true}
                      size={5}
                    />
                    <div className="text-sm truncate">{model.name}</div>
                  </div>
                </SelectItem>
              ))}
          </>
        )}
        
        {/* 用户分组 */}
        {modelsWithAvatars.filter((m) => m.type === "user").length > 0 && (
          <>
            {modelsWithAvatars.filter((m) => m.type === "agent").length > 0 && (
              <div className="mx-2 my-1 h-px bg-border" />
            )}
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              用户
            </div>
            {modelsWithAvatars
              .filter((m) => m.type === "user")
              .map((model) => {
                // 判断是否是当前用户（本地用户不显示状态）
                const isModelCurrentUser = isLoggedIn && session?.user && (() => {
                  const currentUserId = session.user.memberId || session.user.email?.split("@")[0] || session.user.id;
                  const modelMemberId = model.id.replace(/^user::/, "");
                  return modelMemberId === currentUserId;
                })();
                
                return (
                  <SelectItem key={model.id} value={model.name}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UnifiedAvatar
                        name={model.name}
                        id={model.id}
                        isAgent={false}
                        size={5}
                        showStatus={!isModelCurrentUser}
                        isOnline={model.isOnline}
                      />
                      <div className="text-sm truncate">{model.name}</div>
                    </div>
                  </SelectItem>
                );
              })}
          </>
        )}
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="size-7 rounded-full bg-foreground p-1 text-background transition-colors duration-200 hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
