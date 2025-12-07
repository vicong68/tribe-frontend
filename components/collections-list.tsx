"use client";

import { useSession } from "next-auth/react";
import { useMemo } from "react";
import useSWR from "swr";
import { getBackendMemberId } from "@/lib/user-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

interface CollectionItem {
  id: string;
  chat_id: string;
  message_id: string;
  message_content: string;
  message_role: "user" | "assistant";
  created_at: string;
}

/**
 * 收藏夹列表组件
 * 展示收藏的消息，按时间顺序紧凑列表
 */
export function CollectionsList() {
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const userId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : null;

  // 获取收藏列表
  const { data: collections, isLoading, mutate } = useSWR<CollectionItem[]>(
    userId ? "/api/collections" : null,
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        // 如果返回 404 或 500，返回空数组而不是抛出错误
        if (response.status === 404 || response.status === 500) {
          return [];
        }
        throw new Error("获取收藏列表失败");
      }
      const data = await response.json();
      // 确保返回的是数组
      return Array.isArray(data) ? data : [];
    },
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  // 按时间倒序排序（最新的在前）
  const sortedCollections = useMemo(() => {
    if (!collections) return [];
    return [...collections].sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeB - timeA;
    });
  }, [collections]);

  if (!isLoggedIn || !userId) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        请先登录以查看收藏
      </div>
    );
  }

  if (isLoading) {
    return (
      <ScrollArea className="flex-1">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (!sortedCollections || sortedCollections.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        暂无收藏消息
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2">
        {sortedCollections.map((item) => (
          <div
            key={item.id}
            className={cn(
              "p-2 rounded-md border border-sidebar-border bg-background hover:bg-accent transition-colors cursor-pointer",
              "text-sm"
            )}
            onClick={() => {
              // TODO: 实现点击收藏项后嵌入到当前对话上下文
              console.log("点击收藏项:", item);
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className={cn(
                "text-xs font-medium",
                item.message_role === "user" ? "text-blue-600" : "text-green-600"
              )}>
                {item.message_role === "user" ? "用户" : "智能体"}
              </span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(item.created_at), "MM-dd HH:mm", { locale: zhCN })}
              </span>
            </div>
            <div className="text-xs text-foreground line-clamp-2">
              {item.message_content}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

