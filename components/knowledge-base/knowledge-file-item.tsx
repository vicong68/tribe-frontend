"use client";

import { useState, useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
// Icons are used in KnowledgeFileActions component
import { File as FileIcon, GripVertical } from "lucide-react";
import { KnowledgeFileActions } from "./knowledge-file-actions";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { formatFileSize, getFileIcon } from "@/lib/file-utils";

export interface KnowledgeFile {
  file_id: string;
  filename: string;
  file_size: number;
  file_type: string;
  file_url?: string;
  upload_status: "uploading" | "success" | "error";
  vectorization_status: "processing" | "completed" | "failed" | "pending";
  vectorization_progress?: number; // 0-100
  folder_id?: string;
  created_at: string;
}

interface KnowledgeFileItemProps {
  file: KnowledgeFile;
  isSelected?: boolean;
  isDimmed?: boolean;
  collectingFolderId?: string | null;
  selectedFolderId?: string | null;
  viewMode?: "grid" | "list";
  onSelect?: (fileId: string) => void;
  onDelete?: (fileId: string) => void;
  onEdit?: (fileId: string) => void;
  onShare?: (fileId: string) => void;
  onAddToFolder?: (fileId: string, folderId: string) => void;
  onAddToContext?: (fileId: string) => void;
  onToggleCollect?: (file: KnowledgeFile) => void;
}

/**
 * 单个文件部件
 * 核心功能：展示文件基础信息和状态，基础操作（删除、修改）
 * 扩展功能：分享、收藏、嵌入对话上下文（工具栏图标，默认隐藏）
 */
export function KnowledgeFileItem({
  file,
  isSelected = false,
  isDimmed = false,
  collectingFolderId = null,
  selectedFolderId = null,
  viewMode = "grid",
  onSelect,
  onDelete,
  onEdit,
  onShare,
  onAddToFolder,
  onAddToContext,
  onToggleCollect,
}: KnowledgeFileItemProps) {
  const [showActions, setShowActions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.file_id });

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // 文件图标
  const FileIconComponent = useMemo(() => getFileIcon(file.file_type), [file.file_type]);

  // 状态标签
  const statusBadge = useMemo(() => {
    if (file.upload_status === "uploading") {
      return (
        <Badge variant="secondary" className="text-xs">
          上传中
        </Badge>
      );
    }
    if (file.upload_status === "error") {
      return (
        <Badge variant="destructive" className="text-xs">
          上传失败
        </Badge>
      );
    }
    if (file.vectorization_status === "processing") {
      return (
        <Badge variant="default" className="text-xs">
          向量化中
        </Badge>
      );
    }
    if (file.vectorization_status === "completed") {
      return (
        <Badge variant="outline" className="text-xs border-green-500 text-green-700 dark:text-green-400">
          已入库
        </Badge>
      );
    }
    if (file.vectorization_status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          入库失败
        </Badge>
      );
    }
    return null;
  }, [file.upload_status, file.vectorization_status]);

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={cn(
        "group relative flex rounded-md border border-sidebar-border bg-sidebar p-2 transition-all hover:bg-accent",
        viewMode === "list" ? "flex-row items-center gap-3" : "flex-col",
        isSelected && "ring-1 ring-primary bg-primary/10",
        isDimmed && "opacity-30",
        isDragging && "cursor-grabbing"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !menuOpen && setShowActions(false)}
    >
      {/* 顶部：拖拽手柄 + 图标和名称 */}
      <div className={cn(
        "flex gap-2",
        viewMode === "list" ? "items-center flex-1" : "items-start flex-col"
      )}>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0 text-muted-foreground cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-3" />
          </Button>
          <div className="flex-shrink-0">
            <FileIconComponent className={cn(
              "text-muted-foreground",
              viewMode === "list" ? "size-4" : "size-5"
            )} />
          </div>
        </div>
        <div className={cn(
          "min-w-0",
          viewMode === "list" ? "flex-1" : "flex-1 w-full"
        )}>
          <div className="truncate font-medium text-xs" title={file.filename}>
            {file.filename}
          </div>
          {viewMode === "grid" && (
            <>
          <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
            {file.file_id}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {statusBadge}
            <span className="text-[10px] text-muted-foreground">
              {formatFileSize(file.file_size)}
            </span>
          </div>
            </>
          )}
          {viewMode === "list" && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                {file.file_id}
              </span>
              {statusBadge}
              <span className="text-[10px] text-muted-foreground">
                {formatFileSize(file.file_size)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 进度条（上传中或向量化中） */}
      {(file.upload_status === "uploading" || file.vectorization_status === "processing") && (
        <div className="mt-1.5">
          <Progress
            value={file.vectorization_progress || 0}
            className="h-0.5"
          />
        </div>
      )}

      {/* 工具栏图标（hover 显示） */}
      {showActions && (
        <KnowledgeFileActions
          file={file}
          isCollected={
            collectingFolderId
              ? false
              : selectedFolderId
              ? file.folder_id === selectedFolderId
              : false
          }
          collectingMode={!!collectingFolderId}
          selectionMode={!!selectedFolderId && !collectingFolderId}
          onToggleCollect={() => onToggleCollect?.(file)}
          onDelete={onDelete}
          onEdit={onEdit}
          onShare={onShare}
          onAddToFolder={onAddToFolder}
          onAddToContext={onAddToContext}
          onMenuToggle={(open) => {
            setMenuOpen(open);
            if (open) setShowActions(true);
          }}
        />
      )}
    </div>
  );
}

