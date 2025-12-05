import equal from "fast-deep-equal";
import { memo } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Action, Actions } from "./elements/actions";
import { CopyIcon, PencilEditIcon, ThumbDownIcon, ThumbUpIcon } from "./icons";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  setMode,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMode?: (mode: "view" | "edit") => void;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();

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

  // 统一编辑和复制操作（左右对称）
  // 所有消息类型都支持编辑和复制
  const isUser = message.role === "user";
  
  return (
    <Actions className={cn(
      isUser ? "justify-end" : "justify-start"
    )}>
      {setMode && (
        <Action
          className={cn(
            "opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100",
            isUser ? "" : ""
          )}
          data-testid="message-edit-button"
          onClick={() => setMode("edit")}
          tooltip="编辑"
        >
          <PencilEditIcon />
        </Action>
      )}
      <Action onClick={handleCopy} tooltip="复制">
        <CopyIcon />
      </Action>

      {/* 仅assistant消息显示赞/踩 */}
      {message.role === "assistant" && (
        <>
          <Action
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
