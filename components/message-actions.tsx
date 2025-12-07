import equal from "fast-deep-equal";
import { memo, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import { Star, MoreVertical } from "lucide-react";
import { useSession } from "next-auth/react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, generateUUID } from "@/lib/utils";
import { getBackendMemberId } from "@/lib/user-utils";
import { useChatModels } from "@/lib/ai/models-client";
import { Action, Actions } from "./elements/actions";
import { CopyIcon, PencilEditIcon, ThumbDownIcon, ThumbUpIcon, ShareIcon, MoreIcon, TrashIcon } from "./icons";
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
  
  // 获取用户列表（用于分享）
  const { models: chatModels } = useChatModels(isLoggedIn, 0);
  const availableUsers = chatModels.filter((model) => {
    if (model.type !== "user") return false;
    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) return false;
    const modelMemberId = model.id.replace(/^user::/, "");
    return model.id !== `user::${currentUserId}` && modelMemberId !== currentUserId;
  });

  if (isLoading) {
    return null;
  }

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("没有可复制的文本！");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success("已复制到剪贴板！");
  };

  // 分享功能：转发消息给指定用户（复用用户-用户消息的完整链路）
  const handleShare = async (targetUserId: string, targetUserName: string) => {
    if (!textFromParts) {
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
      const lines = textFromParts.split('\n');
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
        displayMessageText = `@${targetUserName}\n${textFromParts}`;
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
            isSharedMessage: true, // 标记为分享消息
            sharedTo: targetUserId,
            sharedToName: targetUserName,
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
                text: textFromParts, // 只发送原始消息内容，不包含@用户名和换行
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

  // 收藏功能：将消息添加到收藏夹
  const handleFavorite = async () => {
    if (!textFromParts) {
      toast.error("没有可收藏的内容！");
      return;
    }

    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) {
      toast.error("请先登录！");
      return;
    }

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: message.id,
          message_content: textFromParts,
          message_role: message.role,
        }),
      });

      if (!response.ok) {
        throw new Error("收藏失败");
      }

      toast.success("已收藏");
      // 触发收藏夹列表更新
      mutate("/api/collections");
    } catch (error) {
      toast.error("收藏失败，请稍后重试");
    }
  };

  // 统一编辑和复制操作（左右对称）
  // 所有消息类型都支持编辑和复制
  const isUser = message.role === "user";
  const actionButtonClass = "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100";
  
  return (
    <Actions className={cn(
      isUser ? "justify-end" : "justify-start"
    )}>
      {/* 智能体消息：复制、编辑 */}
      {!isUser && (
        <>
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
          <Action 
            className={actionButtonClass}
            onClick={handleCopy} 
            tooltip="复制"
          >
        <CopyIcon />
      </Action>
        </>
      )}

      {/* 分享按钮：所有消息都支持 */}
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
          align={isUser ? "end" : "start"}
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

      {/* 更多操作下拉菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Action
            className={actionButtonClass}
            tooltip="更多操作"
          >
            <MoreIcon />
          </Action>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align={isUser ? "end" : "start"}
          className="z-[70]"
        >
          <DropdownMenuItem onClick={handleFavorite}>
            <Star className="h-4 w-4" />
            <span className="ml-2">收藏</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="text-destructive"
            onClick={() => {
              // TODO: 实现删除功能
              toast.info("删除功能待实现");
            }}
          >
            <TrashIcon />
            <span className="ml-2">删除</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 仅assistant消息显示赞/踩 */}
      {message.role === "assistant" && (
        <>
          <Action
            className={actionButtonClass}
            data-testid="message-upvote"
            disabled={vote?.isUpvoted}
            onClick={() => {
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
            disabled={vote && !vote.isUpvoted}
            onClick={() => {
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
