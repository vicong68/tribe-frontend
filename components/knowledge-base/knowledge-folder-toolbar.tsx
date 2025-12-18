"use client";

import { useState } from "react";
import { toast } from "../toast";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PlusIcon } from "../icons";
import { Search as SearchIcon } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { folderApi } from "@/lib/knowledge-base-api";

interface KnowledgeFolderToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

/**
 * 文件夹工具栏
 * 包含：新建文件夹、搜索
 */
export function KnowledgeFolderToolbar({
  searchQuery,
  onSearchChange,
}: KnowledgeFolderToolbarProps) {
  const { mutate } = useSWRConfig();
  const [isCreating, setIsCreating] = useState(false);

  // ✅ 最佳实践：简化前端逻辑，验证由后端完成
  const handleCreateFolder = async () => {
    const folderName = prompt("请输入文件夹名称：");
    if (!folderName?.trim()) return;

    setIsCreating(true);
    try {
      await folderApi.create(folderName.trim());
      mutate("/api/knowledge-base/folders");
      toast({ type: "success", description: "文件夹创建成功" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "创建失败",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 border-b border-sidebar-border bg-sidebar p-2 relative z-[1]">
      {/* 新建文件夹按钮 */}
      <Button
        variant="default"
        size="sm"
        disabled={isCreating}
        onClick={handleCreateFolder}
        className="h-7 px-2 text-xs"
      >
        <PlusIcon className="size-3" />
      </Button>

      {/* 搜索框 */}
      <div className="relative flex-1">
        <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="搜索..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>
    </div>
  );
}

