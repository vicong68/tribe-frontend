"use client";

import { useState } from "react";
import {
  ShareIcon,
  StarIcon,
  StarFilledIcon,
  MessageIcon,
  TrashIcon,
  PencilEditIcon,
  DownloadIcon,
  MoreIcon,
  PlusIcon,
} from "../icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import type { KnowledgeFolder } from "./knowledge-folder-item";

interface KnowledgeFolderActionsProps {
  folder: KnowledgeFolder;
  isCollecting: boolean;
  onToggleCollect?: () => void;
  onDelete?: (folderId: string) => void;
  onEdit?: (folderId: string) => void;
  onCreateChild?: (folderId: string) => void;
  onMove?: (folderId: string) => void;
  onShare?: (folderId: string) => void;
  onAddToContext?: (folderId: string) => void;
  onExport?: (folderId: string) => void;
  onMenuToggle?: (open: boolean) => void;
  onContainerClick?: (e: React.MouseEvent) => void;
}

/**
 * 文件夹操作工具栏
 * 类似消息框下方工具栏图标形式，默认隐没，hover 显示
 */
export function KnowledgeFolderActions({
  folder,
  isCollecting,
  onToggleCollect,
  onDelete,
  onEdit,
  onCreateChild,
  onMove,
  onShare,
  onAddToContext,
  onExport,
  onMenuToggle,
  onContainerClick,
}: KnowledgeFolderActionsProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleMenuChange = (open: boolean) => {
    setShowMoreMenu(open);
    onMenuToggle?.(open);
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded bg-background/90 backdrop-blur-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={onContainerClick}
      onMouseDown={onContainerClick}
    >
      <TooltipProvider>
        {/* 收藏文件模式 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollect?.();
              }}
            >
              {isCollecting ? (
                <StarFilledIcon className="size-3 text-yellow-500" />
              ) : (
                <StarIcon className="size-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>收藏文件（筛选未归属文件）</TooltipContent>
        </Tooltip>

        {/* 分享 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onShare?.(folder.folder_id);
              }}
            >
              <ShareIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>分享文件夹</TooltipContent>
        </Tooltip>

        {/* 嵌入对话上下文 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onAddToContext?.(folder.folder_id);
              }}
            >
              <MessageIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>嵌入对话上下文</TooltipContent>
        </Tooltip>

        {/* 新建子文件夹（提取出更多操作） */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onCreateChild?.(folder.folder_id);
              }}
            >
              <PlusIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>添加子文件夹</TooltipContent>
        </Tooltip>

        {/* 更多操作 */}
        <DropdownMenu open={showMoreMenu} onOpenChange={handleMenuChange} modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreIcon className="size-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>更多操作</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit?.(folder.folder_id)}>
              <PencilEditIcon className="mr-2 size-4" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove?.(folder.folder_id)}>
              <MessageIcon className="mr-2 size-4" />
              移动到...
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport?.(folder.folder_id)}>
              <DownloadIcon className="mr-2 size-4" />
              导出文件夹
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete?.(folder.folder_id)}
            >
              <TrashIcon className="mr-2 size-4" />
              删除文件夹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}

