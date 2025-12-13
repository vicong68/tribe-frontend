import equal from "fast-deep-equal";
import { memo, useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import { useSession } from "next-auth/react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, generateUUID, formatMessageTimestamp, getTextFromMessage } from "@/lib/utils";
import { getBackendMemberId } from "@/lib/user-utils";
import { useChatModels } from "@/lib/ai/models-client";
import { Action, Actions } from "./elements/actions";
import { CopyIcon, PencilEditIcon, ThumbDownIcon, ThumbUpIcon, ShareIcon, TrashIcon, StarIcon, StarFilledIcon, MoreIcon } from "./icons";
import useSWR from "swr";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  setMode,
  setMessages,
  sendMessage,
  selectedModelId,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMode?: (mode: "view" | "edit") => void;
  setMessages?: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  sendMessage?: (message: ChatMessage) => void;
  selectedModelId?: string;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showMoreActionsLeft, setShowMoreActionsLeft] = useState(false);
  const [showMoreActionsRight, setShowMoreActionsRight] = useState(false);
  const moreActionsLeftRef = useRef<HTMLDivElement>(null);
  const moreActionsRightRef = useRef<HTMLDivElement>(null);
  
  // 点击外部区域关闭更多操作（左侧）
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreActionsLeftRef.current && !moreActionsLeftRef.current.contains(event.target as Node)) {
        setShowMoreActionsLeft(false);
      }
    };

    if (showMoreActionsLeft) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showMoreActionsLeft]);

  // 点击外部区域关闭更多操作（右侧）
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreActionsRightRef.current && !moreActionsRightRef.current.contains(event.target as Node)) {
        setShowMoreActionsRight(false);
      }
    };

    if (showMoreActionsRight) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showMoreActionsRight]);
  
  // 获取用户列表（用于分享）
  const { models: chatModels } = useChatModels(isLoggedIn, 0);
  const availableUsers = chatModels.filter((model) => {
    if (model.type !== "user") return false;
    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) return false;
    const modelMemberId = model.id.replace(/^user::/, "");
    return model.id !== `user::${currentUserId}` && modelMemberId !== currentUserId;
  });

  // 检查消息是否已收藏
  const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
  const { data: collectionStatus } = useSWR<{ is_collected: boolean; collection: any }>(
    isLoggedIn && currentUserId && message.id
      ? `/api/collections/check?message_id=${encodeURIComponent(message.id)}`
      : null,
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        return { is_collected: false, collection: null };
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
  
  const isCollected = collectionStatus?.is_collected ?? false;

  if (isLoading) {
    return null;
  }

  // ✅ 提取完整的消息内容（用于保存到后端，包括复杂结构如 reasoning、tool 等）
  // 优化：简化逻辑，优先使用 getTextFromMessage，只在需要复杂结构时才额外提取
  const extractFullMessageContent = (): string => {
    // 1. 先尝试使用统一的提取函数（优先使用 content，回退到 parts）
    const baseContent = getTextFromMessage(message);
    
    // 2. 检查是否需要提取复杂结构（reasoning、tool 等）
    const hasComplexParts = message.parts && message.parts.some((part) => 
      part.type === "reasoning" || 
      part.type === "tool-getWeather" || 
      part.type === "tool-createDocument" || 
      part.type === "tool-updateDocument" || 
      part.type === "tool-requestSuggestions"
    );

    // 3. 如果包含复杂结构，从 parts 提取完整信息（包含推理过程和工具调用结果）
    if (hasComplexParts && message.parts) {
      const contentParts: string[] = [];
      message.parts.forEach((part) => {
        if (part.type === "text" && (part as any).text) {
          contentParts.push((part as any).text);
        } else if (part.type === "reasoning" && (part as any).reasoning) {
          contentParts.push(`[推理过程]\n${(part as any).reasoning}`);
        } else if (part.type === "tool-getWeather" || part.type === "tool-createDocument" || part.type === "tool-updateDocument" || part.type === "tool-requestSuggestions") {
          const toolPart = part as any;
          const toolName = toolPart.toolName || toolPart.name || "未知工具";
          const toolArgs = toolPart.args ? JSON.stringify(toolPart.args, null, 2) : "";
          const toolResult = toolPart.result ? JSON.stringify(toolPart.result, null, 2) : "";
          contentParts.push(`[工具调用: ${toolName}]\n参数: ${toolArgs}\n结果: ${toolResult}`);
        }
      });
      if (contentParts.length > 0) {
        return contentParts.join("\n\n").trim();
      }
    }

    // 4. 如果没有复杂结构，直接返回基础内容（已通过 getTextFromMessage 获取）
    return baseContent;
  };

  const handleCopy = async () => {
    // ✅ 参考编辑按钮的实现：在点击时实时获取消息内容（而不是使用预先计算的 textContent）
    // 这样可以确保在流式消息渲染完成后能获取完整内容
    const contentToCopy = getTextFromMessage(message);
    
    if (!contentToCopy || !contentToCopy.trim()) {
      toast.error("没有可复制的文本！");
      return;
    }

    await copyToClipboard(contentToCopy);
    toast.success("已复制到剪贴板！");
  };

  // 分享功能：转发消息给指定用户（复用用户-用户消息的完整链路）
  const handleShare = async (targetUserId: string, targetUserName: string) => {
    // ✅ 参考编辑按钮的实现：在点击时实时获取消息内容（而不是使用预先计算的 textContent）
    const contentToShare = getTextFromMessage(message);
    
    if (!contentToShare || !contentToShare.trim()) {
      toast.error("没有可分享的内容！");
      return;
    }

    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) {
      toast.error("请先登录！");
      return;
    }

    if (!setMessages) {
      toast.error("分享功能需要消息管理功能，请刷新页面后重试");
      return;
    }

    try {
      // 1. 先在对话区添加一条显示消息（消息开头添加 @用户名，@xxx后换行）
      // 这条消息仅用于显示，不会发送给后端
      // 格式处理：检查原消息是否有markdown格式符号（如 #、*、-、`、> 等）
      // 如果有格式符号，在格式符号之前插入 @xxx\n，保持原消息格式
      // 如果没有格式符号，直接在开头添加 @xxx\n
      let displayMessageText: string;
      
      // 检查是否以markdown格式符号开头（#、*、-、`、>、1.、- [ ] 等）
      // 支持多行消息，检查第一行是否有格式符号
      const lines = contentToShare.split('\n');
      const firstLine = lines[0];
      const markdownPattern = /^(\s*)([#*\-`>]|\d+\.|\- \[ \]|\- \[x\]|```|~~~)/;
      const match = firstLine.match(markdownPattern);
      
      if (match) {
        // 有格式符号：在第一行格式符号之前插入 @xxx\n
        // 例如："# 标题" -> "@xxx\n# 标题"
        // 例如："  - 列表项" -> "@xxx\n  - 列表项"
        // 例如："```python" -> "@xxx\n```python"
        const prefix = match[1]; // 保留前导空格
        const formatSymbol = match[2]; // 格式符号
        const restOfFirstLine = firstLine.substring(match[0].length);
        // 重新组合：@xxx + 换行 + 第一行（格式符号前插入） + 其余行
        const modifiedFirstLine = `${prefix}${formatSymbol}${restOfFirstLine}`;
        const remainingLines = lines.slice(1);
        displayMessageText = `@${targetUserName}\n${modifiedFirstLine}${remainingLines.length > 0 ? '\n' + remainingLines.join('\n') : ''}`;
      } else {
        // 没有格式符号：直接在开头添加 @xxx\n
        displayMessageText = `@${targetUserName}\n${contentToShare}`;
      }
      
      const displayMessageId = generateUUID();
      
      // 添加显示消息到对话区
      setMessages((prevMessages) => {
        const displayMessage: ChatMessage = {
          id: displayMessageId,
          role: "user",
          parts: [
            {
              type: "text",
              text: displayMessageText,
            },
          ],
          metadata: {
            ...message.metadata,
            ...({
              isSharedMessage: true, // 标记为分享消息
              sharedTo: targetUserId,
              sharedToName: targetUserName,
            } as any),
          },
        };
        return [...prevMessages, displayMessage];
      });

      // 2. 直接调用 /api/chat API，明确指定 selectedChatModel 为 "user::${targetUserId}"
      // 重要：不能使用 sendMessage，因为 sendMessage 会使用当前选择的智能体（如司仪）
      // 必须直接调用 API 并明确指定目标用户，确保消息只发送给目标用户，不会发送给当前选择的智能体
      const shareMessageId = generateUUID();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: chatId, // 使用当前对话的 ID
          message: {
            id: shareMessageId,
            role: "user",
              parts: [
                {
                  type: "text",
                  text: contentToShare, // 只发送原始消息内容，不包含@用户名和换行
                },
              ],
          },
          // 关键：明确指定 selectedChatModel 为 "user::${targetUserId}"
          // 这样前端 API 路由会识别为用户-用户消息，不会发送给当前选择的智能体
          selectedChatModel: `user::${targetUserId}`,
          selectedVisibilityType: "private", // 分享消息默认为私密
        }),
      });

      if (!response.ok) {
        // 如果发送失败，移除显示消息
        setMessages((prevMessages) => 
          prevMessages.filter((msg) => msg.id !== displayMessageId)
        );
        
        // 尝试解析错误信息
        let errorMessage = "分享失败";
        try {
          const errorText = await response.text();
          if (errorText) {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch {
              errorMessage = errorText || errorMessage;
            }
          }
        } catch {
          // 忽略解析错误
        }
        throw new Error(errorMessage);
      }

      // 读取响应流直到完成（确保消息已发送）
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          // 忽略读取错误，消息可能已经发送成功
        }
      }

      toast.success(`已分享给 ${targetUserName}`);
      setShowShareMenu(false);
    } catch (error) {
      console.error("[Share] Error:", error);
      toast.error(error instanceof Error ? error.message : "分享失败，请稍后重试");
    }
  };

  // 收藏功能：切换收藏状态（添加/取消收藏）
  const handleFavorite = async () => {
    // ✅ 参考编辑按钮的实现：在点击时实时获取消息内容（而不是使用预先计算的 textContent）
    // 注意：取消收藏不需要内容，但添加收藏需要完整内容
    const contentToCollect = getTextFromMessage(message);

    if (!currentUserId) {
      toast.error("请先登录！");
      return;
    }

    // 如果已收藏，则取消收藏
    if (isCollected) {
      try {
        const response = await fetch(
          `/api/collections?message_id=${encodeURIComponent(message.id)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
          }
        );

        if (!response.ok) {
          throw new Error("取消收藏失败");
        }

        toast.success("已取消收藏");
        // 触发收藏状态和收藏夹列表更新
        mutate(`/api/collections/check?message_id=${encodeURIComponent(message.id)}`);
        mutate("/api/collections");
      } catch (error) {
        toast.error("取消收藏失败，请稍后重试");
      }
      return;
    }

    // 如果未收藏，则添加收藏
    // 获取完整的原始消息信息
    const metadata = message.metadata || {};
    let senderName: string;
    if (message.role === "user") {
      // 用户消息：使用metadata中的senderName或从session获取
      senderName = (metadata as any).senderName || session?.user?.email?.split("@")[0] || "用户";
    } else {
      // Assistant消息：优先使用metadata中的senderName
      senderName = (metadata as any).senderName || (metadata as any).agentUsed || "智能体";
    }

    // 提取文件附件信息（用于保存到后端完整信息）
    const fileAttachments = message.parts
      ?.filter((part) => part.type === "file")
      .map((part) => {
        const fileInfo = (part as any).file || part;
        return {
          name: fileInfo.name || fileInfo.filename || "文件",
          url: fileInfo.url || fileInfo.download_url || "",
          contentType: fileInfo.mediaType || fileInfo.file_type || "application/octet-stream",
          size: fileInfo.size,
          fileId: fileInfo.fileId || fileInfo.file_id || "",
        };
      }) || [];

    // ✅ 构建保存到后端的完整消息内容（包含所有信息：文本、推理、工具调用、文件等）
    // extractFullMessageContent 会在需要时提取复杂结构，否则使用 getTextFromMessage 的结果
    let contentForBackend = extractFullMessageContent();
    if (fileAttachments.length > 0) {
      const fileInfoText = fileAttachments.map((file, index) => {
        return `[附件 ${index + 1}]\n文件名: ${file.name}\n类型: ${file.contentType}\n大小: ${file.size ? `${(file.size / 1024).toFixed(2)} KB` : "未知"}\n文件ID: ${file.fileId}\n下载链接: ${file.url}`;
      }).join("\n\n");
      contentForBackend = contentForBackend 
        ? `${contentForBackend}\n\n${fileInfoText}`
        : fileInfoText;
    }

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: message.id,
          message_content: contentForBackend, // 保存完整信息到后端
          message_role: message.role,
          sender_name: senderName,
        }),
      });

      if (!response.ok) {
        throw new Error("收藏失败");
      }

      toast.success("已收藏");
      // 触发收藏状态和收藏夹列表更新
      mutate(`/api/collections/check?message_id=${encodeURIComponent(message.id)}`);
      mutate("/api/collections");
    } catch (error) {
      toast.error("收藏失败，请稍后重试");
    }
  };

  const handleDelete = async () => {
    if (!setMessages) {
      toast.error("删除失败，请刷新页面后重试");
      return;
    }

    const deletePromise = (async () => {
      const response = await fetch(`/api/message/${message.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        let errorMessage = "删除失败，请稍后重试";
        try {
          const errorText = await response.text();
          if (errorText) {
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.message || errorData.error || errorMessage;
            } catch {
              errorMessage = errorText || errorMessage;
            }
          }
        } catch {
          // 忽略解析错误，使用默认错误信息
        }
        throw new Error(errorMessage);
      }

      setMessages((prevMessages) =>
        prevMessages.filter((currentMessage) => currentMessage.id !== message.id)
      );
      mutate(`/api/vote?chatId=${chatId}`);
      return "已删除该消息";
    })();

    toast.promise(deletePromise, {
      loading: "正在删除消息...",
      success: (successMessage) => successMessage,
      error: (error) =>
        error instanceof Error ? error.message : "删除失败，请稍后重试",
    });
  };

  // 统一编辑和复制操作（左右对称）
  // 所有消息类型都支持编辑和复制
  const isUser = message.role === "user";
  const actionButtonClass = "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100";
  
  // 获取消息时间戳
  // ✅ 优化方案：data-persisted 事件已包含完整的 metadata（包含 createdAt）
  // 消息对象会在流式完成后立即更新，时间戳立即可用
  const messageTimestamp = message.metadata?.createdAt;
  const formattedTimestamp = messageTimestamp ? formatMessageTimestamp(messageTimestamp) : "";
  
  return (
    <Actions className={cn(
      isUser ? "justify-end" : "justify-start"
    )}>
      {/* 左侧：智能体/远端用户消息 */}
      {!isUser && (
        <>
          {/* 编辑按钮 */}
          {setMode && (
            <Action
              className={actionButtonClass}
              data-testid="message-edit-button"
              onClick={() => setMode("edit")}
              tooltip="编辑"
            >
              <PencilEditIcon />
            </Action>
          )}
          
          {/* 收藏按钮 */}
          <Action
            className={actionButtonClass}
            onClick={handleFavorite}
            tooltip={isCollected ? "取消收藏" : "收藏"}
          >
            {isCollected ? <StarFilledIcon /> : <StarIcon />}
          </Action>

          {/* 分享按钮 */}
          <DropdownMenu open={showShareMenu} onOpenChange={setShowShareMenu}>
            <DropdownMenuTrigger asChild>
              <Action
                className={actionButtonClass}
                tooltip="分享"
              >
                <ShareIcon />
              </Action>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="start"
              className="max-h-[300px] overflow-y-auto z-[70]"
            >
              {availableUsers.length === 0 ? (
                <DropdownMenuItem disabled>
                  暂无可分享的用户
                </DropdownMenuItem>
              ) : (
                availableUsers.map((user) => (
                  <DropdownMenuItem
                    key={user.id}
                    onClick={() => {
                      const userId = user.id.replace(/^user::/, "");
                      handleShare(userId, user.name);
                    }}
                  >
                    {user.name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 更多操作：复制、删除 */}
          <div className="relative" ref={moreActionsLeftRef}>
            <Action
              className={actionButtonClass}
              onClick={() => setShowMoreActionsLeft(!showMoreActionsLeft)}
              tooltip="更多操作"
            >
              <MoreIcon />
            </Action>
            {showMoreActionsLeft && (
              <div className="absolute top-full left-0 mt-1 flex gap-1 bg-background rounded-md p-1 shadow-lg z-[70]">
                <Action
                  className={actionButtonClass}
                  onClick={() => {
                    handleCopy();
                    setShowMoreActionsLeft(false);
                  }}
                  tooltip="复制"
                >
                  <CopyIcon />
                </Action>
                <Action
                  className={cn(actionButtonClass, "text-destructive")}
                  onClick={() => {
                    handleDelete();
                    setShowMoreActionsLeft(false);
                  }}
                  tooltip="删除"
                >
                  <TrashIcon />
                </Action>
              </div>
            )}
          </div>
        </>
      )}

      {/* 右侧：本地用户消息 */}
      {isUser && (
        <>
          {/* 时间戳 - 右侧工具栏最左边 */}
          {formattedTimestamp && (
            <span className="text-xs text-muted-foreground/60 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100 mr-1">
              {formattedTimestamp}
            </span>
          )}
          
          {/* 复制按钮 */}
          <Action
            className={actionButtonClass}
            onClick={handleCopy}
            tooltip="复制"
          >
            <CopyIcon />
          </Action>

          {/* 收藏按钮 */}
          <Action
            className={actionButtonClass}
            onClick={handleFavorite}
            tooltip={isCollected ? "取消收藏" : "收藏"}
          >
            {isCollected ? <StarFilledIcon /> : <StarIcon />}
          </Action>

          {/* 更多操作：分享、删除 */}
          <div className="relative" ref={moreActionsRightRef}>
            <Action
              className={actionButtonClass}
              onClick={() => setShowMoreActionsRight(!showMoreActionsRight)}
              tooltip="更多操作"
            >
              <MoreIcon />
            </Action>
            {showMoreActionsRight && (
              <div className="absolute top-full right-0 mt-1 flex gap-1 bg-background rounded-md p-1 shadow-lg z-[70]">
                {/* 分享按钮 */}
                <DropdownMenu open={showShareMenu} onOpenChange={setShowShareMenu}>
                  <DropdownMenuTrigger asChild>
                    <Action
                      className={actionButtonClass}
                      tooltip="分享"
                    >
                      <ShareIcon />
                    </Action>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent 
                    align="end"
                    className="max-h-[300px] overflow-y-auto z-[80]"
                  >
                    {availableUsers.length === 0 ? (
                      <DropdownMenuItem disabled>
                        暂无可分享的用户
                      </DropdownMenuItem>
                    ) : (
                      availableUsers.map((user) => (
                        <DropdownMenuItem
                          key={user.id}
                          onClick={() => {
                            const userId = user.id.replace(/^user::/, "");
                            handleShare(userId, user.name);
                            setShowMoreActionsRight(false);
                          }}
                        >
                          {user.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Action
                  className={cn(actionButtonClass, "text-destructive")}
                  onClick={() => {
                    handleDelete();
                    setShowMoreActionsRight(false);
                  }}
                  tooltip="删除"
                >
                  <TrashIcon />
                </Action>
              </div>
            )}
          </div>
        </>
      )}

      {/* 仅assistant消息显示赞/踩 */}
      {/* 优化：点赞和点踩功能不依赖消息内容，在流式响应完成后即可使用 */}
      {message.role === "assistant" && (
        <>
          <Action
            className={actionButtonClass}
            data-testid="message-upvote"
            disabled={vote?.isUpvoted || isLoading}
            onClick={() => {
              // 点赞功能：不依赖消息内容，只要消息ID存在即可
              if (!message.id) {
                toast.error("消息ID不存在，无法点赞");
                return;
              }
              const upvote = fetch("/api/vote", {
                method: "PATCH",
                body: JSON.stringify({
                  chatId,
                  messageId: message.id,
                  type: "up",
                }),
              });

              toast.promise(upvote, {
                loading: "正在点赞...",
                success: () => {
                  mutate<Vote[]>(
                    `/api/vote?chatId=${chatId}`,
                    (currentVotes) => {
                      if (!currentVotes) {
                        return [];
                      }

                      const votesWithoutCurrent = currentVotes.filter(
                        (currentVote) => currentVote.messageId !== message.id
                      );

                      return [
                        ...votesWithoutCurrent,
                        {
                          chatId,
                          messageId: message.id,
                          isUpvoted: true,
                        },
                      ];
                    },
                    { revalidate: false }
                  );

                  return "已点赞！";
                },
                error: "点赞失败。",
              });
            }}
            tooltip="点赞回复"
          >
            <ThumbUpIcon />
          </Action>

          <Action
            className={actionButtonClass}
            data-testid="message-downvote"
            disabled={(vote && !vote.isUpvoted) || isLoading}
            onClick={() => {
              // 点踩功能：不依赖消息内容，只要消息ID存在即可
              if (!message.id) {
                toast.error("消息ID不存在，无法点踩");
                return;
              }
              const downvote = fetch("/api/vote", {
                method: "PATCH",
                body: JSON.stringify({
                  chatId,
                  messageId: message.id,
                  type: "down",
                }),
              });

              toast.promise(downvote, {
                loading: "正在点踩...",
                success: () => {
                  mutate<Vote[]>(
                    `/api/vote?chatId=${chatId}`,
                    (currentVotes) => {
                      if (!currentVotes) {
                        return [];
                      }

                      const votesWithoutCurrent = currentVotes.filter(
                        (currentVote) => currentVote.messageId !== message.id
                      );

                      return [
                        ...votesWithoutCurrent,
                        {
                          chatId,
                          messageId: message.id,
                          isUpvoted: false,
                        },
                      ];
                    },
                    { revalidate: false }
                  );

                  return "已点踩！";
                },
                error: "点踩失败。",
              });
            }}
            tooltip="点踩回复"
          >
            <ThumbDownIcon />
          </Action>
          
          {/* ✅ 时间戳 - 左侧工具栏最右边（点踩按钮之后） */}
          {/* 注意：此块在 assistant 消息内，无需检查 !isUser */}
          {formattedTimestamp && (
            <span className="text-xs text-muted-foreground/60 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100 ml-1">
              {formattedTimestamp}
            </span>
          )}
        </>
      )}
    </Actions>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }

    return true;
  }
);
