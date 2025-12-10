"use client";

import { useSession } from "next-auth/react";
import { useMemo, useState, useEffect, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { getBackendMemberId } from "@/lib/user-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format as formatDate } from "date-fns";
import { zhCN } from "date-fns/locale";
import { StarFilledIcon, StarIcon, DownloadIcon } from "./icons";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
 * 收藏消息工具栏组件
 * 显示在收藏消息模块标题栏下方
 */
export function CollectionsToolbar() {
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const userId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : null;
  
  // 获取收藏列表
  const { data: collections } = useSWR<CollectionItem[]>(
    userId ? "/api/collections" : null,
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }
  );

  // 从完整内容中提取主要内容（用于前端展示）
  const extractMainContent = (fullContent: string): string => {
    if (!fullContent) return "";
    const paragraphs = fullContent.split(/\n\n+/);
    const mainParts: string[] = [];
    for (const para of paragraphs) {
      if (para.startsWith('[推理过程]') || para.startsWith('[工具调用:')) continue;
      if (para.startsWith('[附件')) {
        const lines = para.split('\n');
        const fileName = lines.find(l => l.startsWith('文件名:'))?.replace('文件名:', '').trim() || '';
        const fileUrl = lines.find(l => l.startsWith('下载链接:'))?.replace('下载链接:', '').trim() || '';
        if (fileName) mainParts.push(`[附件] ${fileName}${fileUrl ? ` (${fileUrl})` : ''}`);
      } else {
        mainParts.push(para);
      }
    }
    return mainParts.join('\n\n').trim();
  };

  // 格式化完整内容用于保存文件（优化显示格式）
  const formatContentForFile = (fullContent: string, fileFormat: "txt" | "md"): string => {
    if (!fullContent) return "";
    const paragraphs = fullContent.split(/\n\n+/);
    const formattedParts: string[] = [];
    
    for (const para of paragraphs) {
      if (para.startsWith('[推理过程]')) {
        const reasoning = para.replace('[推理过程]\n', '').trim();
        if (fileFormat === "md") {
          formattedParts.push(`**推理过程**:\n\n\`\`\`\n${reasoning}\n\`\`\``);
        } else {
          formattedParts.push(`[推理过程]\n${"=".repeat(40)}\n${reasoning}\n${"=".repeat(40)}`);
        }
      } else if (para.startsWith('[工具调用:')) {
        if (fileFormat === "md") {
          formattedParts.push(`**工具调用**:\n\n\`\`\`\n${para}\n\`\`\``);
        } else {
          formattedParts.push(`${para}\n${"-".repeat(40)}`);
        }
      } else if (para.startsWith('[附件')) {
        if (fileFormat === "md") {
          const lines = para.split('\n');
          const fileInfo: Record<string, string> = {};
          lines.forEach(line => {
            if (line.includes(':')) {
              const [key, ...valueParts] = line.split(':');
              fileInfo[key.trim()] = valueParts.join(':').trim();
            }
          });
          const fileName = fileInfo['文件名'] || fileInfo['附件 1'] || '';
          const fileType = fileInfo['类型'] || '';
          const fileSize = fileInfo['大小'] || '';
          const fileUrl = fileInfo['下载链接'] || '';
          const fileId = fileInfo['文件ID'] || '';
          let text = `**附件**: ${fileName}`;
          if (fileType) text += ` (${fileType})`;
          if (fileSize) text += ` - ${fileSize}`;
          if (fileUrl) text += `\n\n下载链接: ${fileUrl}`;
          if (fileId) text += `\n\n文件ID: \`${fileId}\``;
          formattedParts.push(text);
        } else {
          const lines = para.split('\n');
          formattedParts.push(lines.map(line => `   ${line}`).join('\n'));
        }
      } else {
        formattedParts.push(para);
      }
    }
    return formattedParts.join('\n\n');
  };

  // 保存文件到本地（使用后端返回的完整内容）
  const handleSave = (fileFormat: "txt" | "md") => {
    if (!collections || collections.length === 0) {
      toast.error("暂无收藏消息可保存");
      return;
    }

    try {
      const sorted = [...collections].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const now = new Date();
      const timeStr = formatDate(now, "yyyyMMdd_HHmmss", { locale: zhCN });
      const fileName = `收藏消息_${timeStr}.${fileFormat}`;
      const exportTime = formatDate(now, "yyyy-MM-dd HH:mm:ss", { locale: zhCN });

      let content = fileFormat === "md"
        ? `# 收藏消息\n\n**导出时间**: ${exportTime}\n**消息数量**: ${sorted.length} 条\n\n---\n\n`
        : `收藏消息\n${"=".repeat(50)}\n\n导出时间: ${exportTime}\n消息数量: ${sorted.length} 条\n\n${"=".repeat(50)}\n\n`;

      sorted.forEach((item, index) => {
        const date = formatDate(new Date(item.created_at), "yyyy-MM-dd HH:mm:ss", { locale: zhCN });
        const sender = item.sender_name || (item.message_role === "user" ? "用户" : "智能体");
        const roleLabel = item.message_role === "user" ? (fileFormat === "md" ? "👤" : "[用户]") : (fileFormat === "md" ? "🤖" : "[智能体]");
        const fullContent = item.message_content || ""; // 使用后端返回的完整内容
        const formattedContent = formatContentForFile(fullContent, fileFormat);
        
        if (fileFormat === "md") {
          content += `## ${index + 1}. ${roleLabel} ${sender}\n\n`;
          content += `**消息ID**: \`${item.message_id}\`\n`;
          content += `**对话ID**: \`${item.chat_id}\`\n`;
          content += `**消息类型**: ${item.message_role === "user" ? "用户消息" : "智能体消息"}\n`;
          content += `**发送者**: ${sender}\n`;
          content += `**收藏时间**: ${date}\n\n`;
          content += `**消息内容**:\n\n${formattedContent}\n\n---\n\n`;
        } else {
          content += `${index + 1}. ${roleLabel} ${sender}\n`;
          content += `   消息ID: ${item.message_id}\n`;
          content += `   对话ID: ${item.chat_id}\n`;
          content += `   消息类型: ${item.message_role === "user" ? "用户消息" : "智能体消息"}\n`;
          content += `   发送者: ${sender}\n`;
          content += `   收藏时间: ${date}\n`;
          content += `   消息内容:\n${formattedContent}`;
          if (!formattedContent.endsWith('\n')) content += '\n';
          content += `\n${"-".repeat(50)}\n\n`;
        }
      });

      const blob = new Blob([content], { type: fileFormat === "md" ? "text/markdown" : "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success("已保存");
    } catch (error) {
      console.error("保存文件失败:", error);
      toast.error("保存失败");
    }
  };

  if (!userId || !collections || collections.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-7 shrink-0 px-2 min-w-[2rem]"
                type="button"
                variant="ghost"
                size="sm"
              >
                <DownloadIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleSave("txt")}>
                TXT
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSave("md")}>
                Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent>保存收藏消息</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * 收藏夹列表组件
 * 展示收藏的消息，按时间顺序紧凑列表
 */
export function CollectionsList() {
  const [mounted, setMounted] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const { data: session } = useSession();
  const { mutate: globalMutate } = useSWRConfig();
  
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

  // 从完整内容中提取主要内容（去除推理过程、工具调用等，只保留文本和简单附件信息）
  const extractMainContent = useCallback((fullContent: string): string => {
    if (!fullContent) return "";
    
    // 按段落分割
    const paragraphs = fullContent.split(/\n\n+/);
    const mainParts: string[] = [];
    
    for (const para of paragraphs) {
      // 跳过推理过程
      if (para.startsWith('[推理过程]')) continue;
      // 跳过工具调用
      if (para.startsWith('[工具调用:')) continue;
      // 保留文本内容和简单的附件信息
      if (para.startsWith('[附件')) {
        // 简化附件信息，只保留文件名和链接
        const lines = para.split('\n');
        const fileName = lines.find(l => l.startsWith('文件名:'))?.replace('文件名:', '').trim() || '';
        const fileUrl = lines.find(l => l.startsWith('下载链接:'))?.replace('下载链接:', '').trim() || '';
        if (fileName) {
          mainParts.push(`[附件] ${fileName}${fileUrl ? ` (${fileUrl})` : ''}`);
        }
      } else {
        // 保留其他内容（主要是文本内容）
        mainParts.push(para);
      }
    }
    
    return mainParts.join('\n\n').trim();
  }, []);

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
  const handleDeleteCollection = async (
    collectionId: string,
    messageId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation(); // 阻止点击事件冒泡到父元素

    if (!userId) {
      toast.error("请先登录！");
      return;
    }

    try {
      const response = await fetch(`/api/collections?id=${encodeURIComponent(collectionId)}&user_id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      toast.success("已删除");
      // 更新收藏列表
      // 更新收藏列表
      mutate();
      // 同步更新对应消息的收藏状态（对话区星标应变为未收藏）
      if (messageId) {
        globalMutate(`/api/collections/check?message_id=${encodeURIComponent(messageId)}`);
      }
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
    <ScrollArea className="flex-1 h-full w-full overflow-visible">
      <div className="space-y-0.5 px-1 pb-1">
        {sortedCollections.map((item) => (
          <div
            key={item.id}
            className={cn(
              "p-1 rounded-sm border border-sidebar-border bg-background hover:bg-accent transition-colors cursor-pointer",
              "text-[11px] relative group/item w-full"
            )}
            onMouseEnter={() => setHoveredItemId(item.id)}
            onMouseLeave={() => setHoveredItemId(null)}
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
              {extractMainContent(item.message_content)}
            </div>
            <div className="text-[9px] text-muted-foreground mt-0.5 relative flex items-center gap-1">
              {hoveredItemId === item.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 shrink-0 text-muted-foreground hover:text-foreground z-50 flex-shrink-0"
                  onClick={(e) => handleDeleteCollection(item.id, item.message_id, e)}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="取消收藏"
                  type="button"
                >
                  <StarFilledIcon size={12} />
                </Button>
              )}
              <span className="flex-1">{formatDate(new Date(item.created_at), "MM-dd HH:mm", { locale: zhCN })}</span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

