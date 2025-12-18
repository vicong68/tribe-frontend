"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
// Icons are used in KnowledgeFolderActions component
import { Folder as FolderIcon } from "lucide-react";
import { KnowledgeFolderActions } from "./knowledge-folder-actions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export interface KnowledgeFolder {
  folder_id: string;
  folder_name: string;
  file_count: number;
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface KnowledgeFolderItemProps {
  folder: KnowledgeFolder;
  isSelected?: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
  isCollecting?: boolean;
  onSelect?: (folderId: string | null) => void;
  onDelete?: (folderId: string) => void;
  onEdit?: (folderId: string) => void;
  onCreateChild?: (folderId: string) => void;
  onMove?: (folderId: string) => void;
  onShare?: (folderId: string) => void;
  onAddToContext?: (folderId: string) => void;
  onExport?: (folderId: string) => void;
  level?: number;
  onToggleExpand?: (folderId: string) => void;
  onToggleCollect?: () => void;
}

/**
 * 单个文件夹部件
 * 核心功能：收藏文件（单击文件夹，高亮属于该文件夹的文件）
 * 扩展功能：分享、收藏、嵌入对话上下文（工具栏图标，默认隐藏）
 */
export function KnowledgeFolderItem({
  folder,
  isSelected = false,
  isExpanded = false,
  hasChildren = false,
  isCollecting = false,
  onSelect,
  onDelete,
  onEdit,
  onCreateChild,
  onMove,
  onShare,
  onAddToContext,
  onExport,
  level = 0,
  onToggleExpand,
  onToggleCollect,
}: KnowledgeFolderItemProps) {
  const isDraggable = level === 0;
  const [showActions, setShowActions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.folder_id, disabled: !isDraggable });

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = () => {
    onSelect?.(isSelected ? null : folder.folder_id);
  };

  const handleMouseEnter = () => setShowActions(true);
  const handleMouseLeave = () => {
    if (!menuOpen) setShowActions(false);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggleExpand?.(folder.folder_id);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...sortableStyle,
        // 增加层级缩进：每层由 12px 提升为 24px，提升层级可辨识度
        paddingLeft: `${8 + level * 24}px`,
      }}
      className={cn(
        "group relative flex items-center gap-2 bg-sidebar p-2 transition-all hover:bg-accent cursor-pointer overflow-visible z-10",
        // 合并上下边缘：去掉圆角及外边框，仅首尾保持轻微圆角以融入区域
        "rounded-none -mt-px first:mt-0 first:rounded-t-md last:rounded-b-md",
        isSelected && "bg-primary/10", // ✅ 去掉选中后的边框线，只保留背景色
        isDragging && "cursor-grabbing"
      )}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 展开/折叠 + 图标 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isDraggable ? (
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
        ) : (
          <div className="h-5 w-5" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-5 w-5 p-0 text-muted-foreground",
            !hasChildren && "opacity-30 cursor-default"
          )}
          onClick={handleToggleExpand}
          tabIndex={hasChildren ? 0 : -1}
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              hasChildren ? (isExpanded ? "rotate-90" : "rotate-0") : "opacity-0"
            )}
          />
        </Button>
        <FolderIcon className="size-4 text-primary" />
      </div>

      {/* 文件夹信息 */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-xs" title={folder.folder_name}>
          {folder.folder_name}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {folder.file_count}
          </Badge>
        </div>
      </div>

      {/* 工具栏图标（hover 显示，确保在最上层） */}
      {showActions && (
        <div className="relative z-50">
        <KnowledgeFolderActions
          folder={folder}
          isCollecting={isCollecting}
          onToggleCollect={onToggleCollect}
          onDelete={onDelete}
          onEdit={onEdit}
          onCreateChild={onCreateChild}
          onMove={onMove}
          onShare={onShare}
          onAddToContext={onAddToContext}
          onExport={onExport}
          onMenuToggle={(open) => {
            setMenuOpen(open);
            if (open) {
              setShowActions(true);
            }
          }}
          onContainerClick={(e) => e.stopPropagation()}
        />
        </div>
      )}
    </div>
  );
}

