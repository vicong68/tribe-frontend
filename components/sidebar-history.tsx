"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { PlusIcon, TrashIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats
  );
};

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory | null
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `/api/history?limit=${PAGE_SIZE}`;
  }

  // 处理 null 情况（第一页后没有数据）
  if (!previousPageData) {
    return null;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({ user }: { user: User | undefined }) {
  // 移除对左侧边栏的依赖，确保右侧对话栏独立
  const { id } = useParams();
  const router = useRouter();
  const { mutate: mutateSWR } = useSWRConfig();

  // 创建一个条件函数，如果没有用户则返回 null
  const getKey = useCallback(
    (pageIndex: number, previousPageData: ChatHistory | null) => {
      if (!user) {
        return null; // 禁用请求
      }
      return getChatHistoryPaginationKey(pageIndex, previousPageData);
    },
    [user]
  );

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
    error,
  } = useSWRInfinite<ChatHistory>(
    getKey,
    fetcher,
    {
      fallbackData: [],
      onError: () => {
        // 静默处理错误
      },
    }
  );

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  // 获取当前选中对话的 visibility
  const currentChat = useMemo(() => {
    if (!id || !paginatedChatHistories) return null;
    const chatsFromHistory = paginatedChatHistories.flatMap(
      (paginatedChatHistory) => paginatedChatHistory.chats
    );
    return chatsFromHistory.find((chat) => chat.id === id) || null;
  }, [id, paginatedChatHistories]);

  const currentVisibility: VisibilityType = currentChat?.visibility || "private";

  // 处理删除所有对话
  const handleDeleteAll = () => {
    const deletePromise = fetch("/api/history", {
      method: "DELETE",
    });

    toast.promise(deletePromise, {
      loading: "正在删除所有对话...",
      success: () => {
        mutateSWR(unstable_serialize(getChatHistoryPaginationKey));
        router.push("/");
        setShowDeleteAllDialog(false);
        return "所有对话已成功删除";
      },
      error: "删除所有对话失败",
    });
  };

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistories
    ? paginatedChatHistories.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = () => {
    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: "DELETE",
    });

    toast.promise(deletePromise, {
      loading: "正在删除对话...",
      success: () => {
        mutate((chatHistories) => {
          if (chatHistories) {
            return chatHistories.map((chatHistory) => ({
              ...chatHistory,
              chats: chatHistory.chats.filter((chat) => chat.id !== deleteId),
            }));
          }
        });

        return "对话已成功删除";
      },
      error: "删除对话失败",
    });

    setShowDeleteDialog(false);

    if (deleteId === id) {
      router.push("/");
    }
  };

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
            登录以保存和重新访问之前的对话！
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
          今天
        </div>
        <SidebarGroupContent>
          <div className="flex flex-col">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-md px-2"
                key={item}
              >
                <div
                  className="h-4 max-w-(--skeleton-width) flex-1 rounded-md bg-sidebar-accent-foreground/10"
                  style={
                    {
                      "--skeleton-width": `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
            当您开始对话后，您的对话记录将显示在这里！
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup>
        {/* 对话管理工具栏 - 三个组件紧凑排列一行：新对话、删除所有对话、对话属性下拉 */}
        <div className="flex items-center gap-1 px-2 py-2 min-w-0">
          {/* 新对话按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-8 shrink-0 px-2 min-w-[2rem]"
                onClick={() => {
                  router.push("/");
                  router.refresh();
                }}
                type="button"
                variant="ghost"
                size="sm"
              >
                <PlusIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新对话</TooltipContent>
          </Tooltip>

          {/* 删除所有对话按钮 */}
          {user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-8 px-2 shrink-0 min-w-[2rem]"
                  onClick={() => setShowDeleteAllDialog(true)}
                  type="button"
                  variant="ghost"
                  size="sm"
                >
                  <TrashIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除所有对话</TooltipContent>
            </Tooltip>
          )}

          {/* 对话属性下拉组件（私密/公开设置）- 放置在最后 */}
          {id && currentVisibility ? (
            <VisibilitySelector
              chatId={id as string}
              selectedVisibilityType={currentVisibility}
              className="h-8 px-2 shrink-0 min-w-[2rem]"
            />
          ) : (
            // 没有选中对话时，显示占位符以保持布局一致
            <div className="h-8 w-8 shrink-0" />
          )}
        </div>

        <SidebarGroupContent>
          <SidebarMenu>
            {paginatedChatHistories &&
              (() => {
                const chatsFromHistory = paginatedChatHistories.flatMap(
                  (paginatedChatHistory) => paginatedChatHistory.chats
                );

                const groupedChats = groupChatsByDate(chatsFromHistory);

                return (
                  <div className="flex flex-col gap-6">
                    {groupedChats.today.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          今天
                        </div>
                        {groupedChats.today.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.yesterday.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          昨天
                        </div>
                        {groupedChats.yesterday.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastWeek.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          最近7天
                        </div>
                        {groupedChats.lastWeek.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastMonth.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          最近30天
                        </div>
                        {groupedChats.lastMonth.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.older.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          更早
                        </div>
                        {groupedChats.older.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </SidebarMenu>

          <motion.div
            onViewportEnter={() => {
              if (!isValidating && !hasReachedEnd) {
                setSize((size) => size + 1);
              }
            }}
          />

          {hasReachedEnd ? (
            <div className="mt-8 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
              已到达对话历史记录的末尾。
            </div>
          ) : (
            <div className="mt-8 flex flex-row items-center gap-2 p-2 text-zinc-500 dark:text-zinc-400">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div>加载对话中...</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      {/* 删除单个对话确认对话框 */}
      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>您确定吗？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。这将永久删除您的对话并从服务器中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除所有对话确认对话框 */}
      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除所有对话？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。这将永久删除您的所有对话并从服务器中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
              全部删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
