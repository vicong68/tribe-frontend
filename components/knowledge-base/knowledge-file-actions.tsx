"use client";

import { useState } from "react";
import { ShareIcon, StarIcon, StarFilledIcon, DownloadIcon, EyeIcon, MessageIcon, TrashIcon, PencilEditIcon, MoreIcon } from "../icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import type { KnowledgeFile } from "./knowledge-file-item";

interface KnowledgeFileActionsProps {
  file: KnowledgeFile;
  isCollected: boolean;
  collectingMode: boolean;
  selectionMode: boolean;
  onToggleCollect?: () => void;
  onDelete?: (fileId: string) => void;
  onEdit?: (fileId: string) => void;
  onShare?: (fileId: string) => void;
  onAddToFolder?: (fileId: string, folderId: string) => void;
  onAddToContext?: (fileId: string) => void;
  onMenuToggle?: (open: boolean) => void;
}

/**
 * 文件操作工具栏
 * 类似消息框下方工具栏图标形式，默认隐没，hover 显示
 */
export function KnowledgeFileActions({
  file,
  isCollected,
  collectingMode,
  selectionMode,
  onToggleCollect,
  onDelete,
  onEdit,
  onShare,
  onAddToFolder,
  onAddToContext,
  onMenuToggle,
}: KnowledgeFileActionsProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleMenuChange = (open: boolean) => {
    setShowMoreMenu(open);
    onMenuToggle?.(open);
  };

  return (
    <div
      className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-background/90 backdrop-blur-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <TooltipProvider>
        {/* 收藏/移出当前文件夹 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              disabled={!(collectingMode || selectionMode)}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollect?.();
              }}
            >
              {isCollected ? (
                <StarFilledIcon className="size-3 text-yellow-500" />
              ) : (
                <StarIcon className="size-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {collectingMode
              ? "收藏到当前文件夹"
              : selectionMode
              ? "移出当前文件夹"
              : "选择文件夹后再收藏"}
          </TooltipContent>
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
                onShare?.(file.file_id);
              }}
            >
              <ShareIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>分享给好友</TooltipContent>
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
                onAddToContext?.(file.file_id);
              }}
            >
              <MessageIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>嵌入对话上下文</TooltipContent>
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
            <DropdownMenuItem
              onClick={() => onEdit?.(file.file_id)}
            >
              <PencilEditIcon className="mr-2 size-4" />
              修改信息
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => file.file_url && window.open(file.file_url, "_blank")}>
              <EyeIcon className="mr-2 size-4" />
              预览文件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => file.file_url && window.open(file.file_url, "_blank")}>
              <DownloadIcon className="mr-2 size-4" />
              下载文件
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete?.(file.file_id)}
            >
              <TrashIcon className="mr-2 size-4" />
              删除文件
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}

