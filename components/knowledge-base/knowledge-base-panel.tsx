"use client";

import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { KnowledgeFolderList } from "./knowledge-folder-list";
import { KnowledgeFileGrid } from "./knowledge-file-grid";
import { KnowledgeFolderToolbar } from "./knowledge-folder-toolbar";
import { KnowledgeFileToolbar } from "./knowledge-file-toolbar";
import { useEffect, useCallback } from "react";

/**
 * 知识库文件管理主面板
 * 左右两半布局：左侧文件夹区域，右侧文件区域
 */
export function KnowledgeBasePanel() {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [collectingFolderId, setCollectingFolderId] = useState<string | null>(null);
  const [collectReturnFolderId, setCollectReturnFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 拖拽传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 处理文件夹拖拽排序
  const handleFolderDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      // TODO: 更新文件夹顺序
      console.log("Folder reordered:", active.id, over?.id);
    }
  };

  // 处理文件拖拽排序
  const handleFileDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      // TODO: 更新文件顺序
      console.log("File reordered:", active.id, over?.id);
    }
  };

  const clearSelection = useCallback(() => {
    setSelectedFolderId(null);
    setCollectingFolderId(null);
    setCollectReturnFolderId(null);
  }, []);

  // Esc 取消选中/收藏模式
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelection]);

  const handleSelectFolder = (folderId: string | null) => {
    setCollectingFolderId(null);
    setCollectReturnFolderId(null);
    // 切换选择，同点取消
    setSelectedFolderId((prev) => (prev === folderId ? null : folderId));
  };

  const handleToggleCollectMode = (folderId: string) => {
    const entering = collectingFolderId !== folderId;
    if (entering) {
      // 进入收藏模式：记住当前选中（可能为 null），清空选中并设置收藏目标
      setCollectReturnFolderId(selectedFolderId);
      setSelectedFolderId(null);
      setCollectingFolderId(folderId);
      return;
    }
    // 退出收藏模式：若之前选中过同一文件夹，则恢复选中；否则回到全量视图
    const shouldRestore = collectReturnFolderId === folderId;
    setCollectReturnFolderId(null);
    setCollectingFolderId(null);
    setSelectedFolderId(shouldRestore ? folderId : null);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* 面板头部：与对话收藏管理标题垂直对齐 */}
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-3 pt-4">
        <div className="text-sm font-semibold text-sidebar-foreground">知识库管理</div>
      </div>

      {/* 主内容区域：左右两半布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：文件夹区域 (35%) */}
        <div className="flex w-[35%] min-w-[140px] flex-col border-r border-sidebar-border bg-sidebar/50">
          <KnowledgeFolderToolbar
            onSearchChange={setSearchQuery}
            searchQuery={searchQuery}
          />
          <div className="flex-1 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleFolderDragEnd}
            >
              <KnowledgeFolderList
                selectedFolderId={selectedFolderId}
                collectingFolderId={collectingFolderId}
                onSelectFolder={handleSelectFolder}
                onToggleCollectMode={handleToggleCollectMode}
                onBackgroundClick={clearSelection}
                searchQuery={searchQuery}
              />
            </DndContext>
          </div>
        </div>

        {/* 右侧：文件区域 (65%) */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <KnowledgeFileToolbar
            onSearchChange={setSearchQuery}
            searchQuery={searchQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            selectedFolderId={selectedFolderId}
          />
          <div className="flex-1 overflow-y-auto p-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleFileDragEnd}
            >
              <KnowledgeFileGrid
                selectedFolderId={selectedFolderId}
                collectingFolderId={collectingFolderId}
                searchQuery={searchQuery}
                viewMode={viewMode}
              />
            </DndContext>
          </div>
        </div>
      </div>
    </div>
  );
}

