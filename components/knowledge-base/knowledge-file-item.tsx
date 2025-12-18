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
  status: "pending" | "processing" | "completed" | "failed"; // ✅ 统一状态字段
  status_message?: string; // 状态描述信息
  vectorized: boolean; // 是否可用于RAG查询
  vectorization_progress?: number; // 0-100
  folder_id?: string;
  created_at: string;
  upload_date?: string; // ✅ 入库时间（后端返回upload_date）
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

  // ✅ 优化：统一状态标签显示（基于后端返回的status字段）
  // ✅ 优化：状态文字左下角联动，completed为绿色
  const statusBadge = useMemo(() => {
    // 上传状态优先显示
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
    
    // 入库状态（统一使用status字段）
    if (file.status === "processing") {
      return (
        <Badge variant="default" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
          处理中
        </Badge>
      );
    }
    if (file.status === "completed") {
      return (
        <Badge variant="outline" className="text-xs border-green-500 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 dark:border-green-400">
          已入库
        </Badge>
      );
    }
    if (file.status === "failed") {
      return (
        <Badge variant="destructive" className="text-xs">
          入库失败
        </Badge>
      );
    }
    if (file.status === "pending") {
      return (
        <Badge variant="secondary" className="text-xs">
          待处理
        </Badge>
      );
    }
    // ✅ 兼容：如果没有status字段，尝试从其他字段推断
    if (!file.status && file.upload_status === "success") {
      return (
        <Badge variant="secondary" className="text-xs">
          处理中
        </Badge>
      );
    }
    return null;
  }, [file.upload_status, file.status]);

  // ✅ 优化：根据状态设置背景颜色（淡色）+ 状态文字左下角联动
  const statusBgColor = useMemo(() => {
    if (file.status === "completed") {
      return "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800";
    }
    if (file.status === "processing") {
      return "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800";
    }
    if (file.status === "failed") {
      return "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800";
    }
    if (file.status === "pending") {
      return "bg-gray-50/50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800";
    }
    return "";
  }, [file.status]);

  // ✅ 格式化时间戳为"2025/12/15 21:46"格式
  const formatTimestamp = (dateString: string | undefined): string => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch {
      return dateString;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={cn(
        "group relative flex rounded-md border transition-all hover:bg-accent",
        viewMode === "list" ? "flex-row items-center gap-3 px-3 py-2" : "flex-col p-3",
        isSelected && "ring-1 ring-primary bg-primary/10",
        isDimmed && "opacity-30",
        isDragging && "cursor-grabbing",
        // ✅ 优化：状态背景颜色联动（completed为淡绿色）
        statusBgColor || "bg-sidebar border-sidebar-border"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !menuOpen && setShowActions(false)}
    >
      {/* ✅ 优化：网格模式和列表模式分别优化布局 */}
      {viewMode === "grid" ? (
        // 网格模式：纵向布局，图标在上，信息在下
        <>
          {/* 顶部：拖拽手柄 + 图标 + file_id（左上角） */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 flex-shrink-0">
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
                <FileIconComponent className="size-5 text-muted-foreground" />
              </div>
              {/* ✅ 优化：file_id在图标右边展示 */}
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                {file.file_id}
              </span>
            </div>
          </div>

          {/* 中间：文件名 */}
          <div className="flex-1 min-w-0 mb-2">
            <div className="truncate font-medium text-sm mb-1.5" title={file.filename}>
              {file.filename}
            </div>
            {/* ✅ 优化：文件大小和时间戳在同一行，时间戳靠右显示 */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{formatFileSize(file.file_size)}</span>
              {file.upload_date && (
                <span className="flex-shrink-0" title={file.upload_date}>
                  {formatTimestamp(file.upload_date)}
                </span>
              )}
            </div>
          </div>

          {/* 底部：状态标签 */}
          <div className="flex items-center gap-2 mt-auto pt-2 border-t border-sidebar-border/50">
            {statusBadge}
          </div>
        </>
      ) : (
        // 列表模式：横向布局，图标在左，信息在右
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* 左侧：拖拽手柄 + 图标 */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
              <FileIconComponent className="size-4 text-muted-foreground" />
            </div>
          </div>

          {/* 中间：文件名 + file_id + 文件大小 + 时间戳（所有信息在一行展示） */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="truncate font-medium text-sm" title={file.filename}>
                {file.filename}
              </div>
              {/* ✅ 优化：file_id、文件大小在文件名右方 */}
              <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                {file.file_id}
              </span>
              {/* ✅ 优化：文件大小和时间戳在同一行，时间戳靠右显示 */}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[11px] text-muted-foreground">
                  {formatFileSize(file.file_size)}
                </span>
                {file.upload_date && (
                  <span className="text-[11px] text-muted-foreground flex-shrink-0" title={file.upload_date}>
                    {formatTimestamp(file.upload_date)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：状态标签（最右边） */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {statusBadge}
          </div>
        </div>
      )}

      {/* ✅ 优化：进度条和状态消息（仅在网格模式下显示在底部） */}
      {viewMode === "grid" && (
        <>
          {(file.upload_status === "uploading" || file.status === "processing") && (
            <div className="mt-2 mb-1">
              <Progress
                value={file.vectorization_progress || 0}
                className="h-1"
              />
            </div>
          )}
          
          {/* ✅ 优化：状态说明文字适当下移，避免与状态标签太近且有遮挡 */}
          {file.status_message && (
            <div className="text-[10px] text-muted-foreground truncate mb-1 mt-1.5" title={file.status_message}>
              {file.status_message}
            </div>
          )}
        </>
      )}
      
      {/* ✅ 列表模式：状态消息显示在文件名下方，适当下移避免遮挡 */}
      {viewMode === "list" && file.status_message && (
        <div className="text-[10px] text-muted-foreground truncate ml-[52px] mt-1" title={file.status_message}>
          {file.status_message}
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

