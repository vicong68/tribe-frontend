"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useSession } from "next-auth/react";
import { toast } from "../toast";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { UploadIcon } from "../icons";
import { Grid3x3 as GridIcon, List as ListIcon, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import useSWR, { useSWRConfig } from "swr";
import { getBackendMemberId } from "@/lib/user-utils";

interface KnowledgeFileToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  selectedFolderId: string | null;
}

/**
 * 文件工具栏
 * 包含：批量上传、搜索、筛选、视图切换
 */
export function KnowledgeFileToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  selectedFolderId,
}: KnowledgeFileToolbarProps) {
  const { mutate } = useSWRConfig();
  const [isUploading, setIsUploading] = useState(false);
  const { data: session } = useSession();

  // 文件上传处理
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setIsUploading(true);

      try {
        // 获取用户ID和登录状态
        const isLoggedIn = session?.user?.type === "regular";
        const userId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : "guest_user";
        const loginStatus = isLoggedIn ? "已登录" : "未登录";

        const uploadPromises = acceptedFiles.map(async (file) => {
          const formData = new FormData();
          formData.append("files", file);
          formData.append("user_id", userId);
          formData.append("login_status", loginStatus);
          formData.append("transfer_mode", "knowledge");

          const response = await fetch("/api/v1/chat/upload?transfer_mode=knowledge", {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`上传失败: ${file.name}`);
          }

          return response.json();
        });

        await Promise.all(uploadPromises);

        // 刷新文件列表
        mutate("/api/knowledge-base/files");

        toast({
          type: "success",
          description: `成功上传 ${acceptedFiles.length} 个文件`,
        });
      } catch (error) {
        toast({
          type: "error",
          description: error instanceof Error ? error.message : "上传失败",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [mutate, session]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
    },
    multiple: true,
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  return (
    <div className="flex items-center gap-1.5 border-b border-sidebar-border bg-sidebar p-2 relative z-[1]">
      {/* 批量上传按钮 */}
      <div {...getRootProps()} className="flex-shrink-0">
        <input {...getInputProps()} />
        <Button
          variant="default"
          size="sm"
          disabled={isUploading}
          className={cn(
            "h-7 px-2 text-xs transition-colors",
            isDragActive && "bg-primary/80"
          )}
        >
          <UploadIcon className="size-3" />
        </Button>
      </div>

      {/* 搜索框 */}
      <div className="relative flex-1 min-w-0">
        <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="搜索文件..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>

      {/* 视图切换 */}
      <div className="flex items-center gap-0.5 rounded border border-sidebar-border p-0.5 flex-shrink-0">
        <Button
          variant={viewMode === "grid" ? "default" : "ghost"}
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onViewModeChange("grid")}
        >
          <GridIcon className="size-3" />
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "ghost"}
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onViewModeChange("list")}
        >
          <ListIcon className="size-3" />
        </Button>
      </div>
    </div>
  );
}

