"use client";

import { useSession } from "next-auth/react";
import { useMemo, useState, useEffect } from "react";
import useSWR from "swr";
import { getBackendMemberId } from "@/lib/user-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { StarFilledIcon, StarIcon } from "./icons";
import { toast } from "sonner";
import { Button } from "./ui/button";

interface CollectionItem {
  id: string;
  chat_id: string;
  message_id: string;
  message_content: string;
  message_role: "user" | "assistant";
  sender_name?: string | null; // 发送者名称（如：VIcOng、司仪等）
  created_at: string;
}

/**
 * 收藏夹列表组件
 * 展示收藏的消息，按时间顺序紧凑列表
 */
export function CollectionsList() {
  const [mounted, setMounted] = useState(false);
  const { data: session } = useSession();
  
  // 防止 hydration 不匹配：确保服务器端和客户端初始渲染一致
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // ✅ 关键修复：所有 hooks 必须在条件返回之前调用，确保 hooks 调用顺序一致
  // 这是 React Hooks 的规则：hooks 必须在每次渲染时以相同的顺序调用
  const isLoggedIn = session?.user?.type === "regular";
  const userId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : null;

  // 获取收藏列表
  const { data: collections, isLoading, mutate } = useSWR<CollectionItem[]>(
    mounted && userId ? "/api/collections" : null, // 只在 mounted 且 userId 存在时请求
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

  // 删除收藏项（取消收藏）
  const handleDeleteCollection = async (collectionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止点击事件冒泡到父元素

    if (!userId) {
      toast.error("请先登录！");
      return;
    }

    try {
      const response = await fetch(`/api/collections?id=${encodeURIComponent(collectionId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      toast.success("已删除");
      // 更新收藏列表
      mutate();
    } catch (error) {
      toast.error("删除失败，请稍后重试");
    }
  };
  
  // ✅ 关键修复：条件返回必须在所有 hooks 调用之后
  // 在服务器端和客户端初始渲染时，都返回相同的占位符，避免 hydration 不匹配
  // 服务器端渲染时，mounted 为 false，返回占位符
  // 客户端首次渲染时，mounted 仍为 false，保持与服务器端一致
  // 客户端 hydration 完成后，mounted 变为 true，再渲染完整组件
  if (!mounted) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2 px-1.5">
        请先登录以查看收藏
      </div>
    );
  }

  if (!isLoggedIn || !userId) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2 px-1.5">
        请先登录以查看收藏
      </div>
    );
  }

  if (isLoading) {
    return (
      <ScrollArea className="flex-1 h-full w-full">
        <div className="space-y-1 px-1.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (!sortedCollections || sortedCollections.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2 px-1.5">
        暂无收藏消息
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full w-full">
      <div className="space-y-0 px-1 pb-1">
        {sortedCollections.map((item) => (
          <div
            key={item.id}
            className={cn(
              "p-1 rounded-sm border border-sidebar-border bg-background hover:bg-accent transition-colors cursor-pointer",
              "text-[11px] relative group w-full"
            )}
            onClick={() => {
              // TODO: 实现点击收藏项后嵌入到当前对话上下文
              console.log("点击收藏项:", item);
            }}
          >
            <div className="flex items-start justify-between gap-1 mb-0.5 min-w-0">
              <span
                className={cn(
                  "text-[10px] font-medium truncate flex-1 min-w-0",
                  item.message_role === "user" ? "text-blue-600" : "text-green-600"
                )}
              >
                {/* 显示具体名称，如果没有则显示默认值 */}
                {item.sender_name || (item.message_role === "user" ? "用户" : "智能体")}
              </span>
            </div>
            <div className="text-[10px] text-foreground line-clamp-2 leading-tight break-words w-full">
              {item.message_content}
            </div>
            <div className="text-[9px] text-muted-foreground mt-0.5">
              {format(new Date(item.created_at), "MM-dd HH:mm", { locale: zhCN })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

