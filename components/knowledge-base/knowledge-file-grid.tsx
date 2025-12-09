"use client";

import { useMemo } from "react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import useSWR, { useSWRConfig } from "swr";
import { KnowledgeFileItem, type KnowledgeFile } from "./knowledge-file-item";
import { cn } from "@/lib/utils";
import { toast } from "../toast";

interface KnowledgeFileGridProps {
  selectedFolderId: string | null;
  collectingFolderId: string | null;
  searchQuery: string;
  viewMode: "grid" | "list";
}

/**
 * 文件网格/列表组件
 * 展示所有上传文件，支持拖拽排序
 */
export function KnowledgeFileGrid({
  selectedFolderId,
  collectingFolderId,
  searchQuery,
  viewMode,
}: KnowledgeFileGridProps) {
  const { mutate } = useSWRConfig();
  
  // 获取文件列表
  const { data: files, isLoading, error } = useSWR<KnowledgeFile[]>(
    "/api/knowledge-base/files",
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch files");
      return response.json();
    }
  );

  // 处理文件删除
  const handleDelete = async (fileId: string) => {
    try {
      const response = await fetch(`/api/knowledge-base/files/${fileId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      // 刷新文件列表
      mutate("/api/knowledge-base/files");
      
      toast({
        type: "success",
        description: "文件已删除",
      });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "删除失败",
      });
    }
  };

  // 处理文件编辑
  const handleEdit = async (fileId: string) => {
    const file = files?.find((f) => f.file_id === fileId);
    if (!file) return;

    const newFilename = prompt("请输入新文件名：", file.filename);
    if (!newFilename || newFilename.trim() === file.filename) return;

    try {
      const response = await fetch(`/api/knowledge-base/files/${fileId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: newFilename.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("更新失败");
      }

      // 刷新文件列表
      mutate("/api/knowledge-base/files");
      
      toast({
        type: "success",
        description: "文件信息已更新",
      });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "更新失败",
      });
    }
  };

  // 处理文件加入/移出文件夹（收藏逻辑）
  const handleAddToFolder = async (fileId: string, folderId: string | null) => {
    try {
      const response = await fetch(`/api/knowledge-base/files/${fileId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folder_id: folderId,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.detail || "操作失败");
      }

      // 刷新文件列表与文件夹计数
      mutate("/api/knowledge-base/files");
      mutate("/api/knowledge-base/folders");
      
      toast({
        type: "success",
        description: folderId ? "文件已添加到文件夹" : "已移出文件夹",
      });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "操作失败",
      });
    }
  };

  // 过滤文件
  const filteredFiles = useMemo(() => {
    if (!files) return [];
    
    let result = files;

    // 按文件夹过滤
    if (collectingFolderId) {
      // 收藏模式：仅显示未归属文件
      result = result.filter((file) => !file.folder_id);
    } else if (selectedFolderId) {
      result = result.filter((file) => file.folder_id === selectedFolderId);
    }

    // 按搜索关键词过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (file) =>
          file.filename.toLowerCase().includes(query) ||
          file.file_id.toLowerCase().includes(query)
      );
    }

    return result;
  }, [files, selectedFolderId, collectingFolderId, searchQuery]);

  // 判断文件是否应该高亮或隐没
  const getFileState = (file: KnowledgeFile) => {
    if (collectingFolderId) {
      // 收藏模式：均显示未收藏状态，不高亮
      return { isSelected: false, isDimmed: false };
    }
    if (!selectedFolderId) {
      return { isSelected: false, isDimmed: false };
    }
    const belongsToFolder = file.folder_id === selectedFolderId;
    return { isSelected: belongsToFolder, isDimmed: !belongsToFolder };
  };

  const handleToggleCollect = async (file: KnowledgeFile) => {
    // 收藏模式：只能添加未归属文件到 collectingFolderId
    if (collectingFolderId) {
      if (file.folder_id && file.folder_id !== collectingFolderId) {
        toast({ type: "error", description: "文件已属于其他文件夹" });
        return;
      }
      if (file.folder_id === collectingFolderId) {
        toast({ type: "info", description: "已在该文件夹中" });
        return;
      }
      const targetFolder = collectingFolderId;
      await handleAddToFolder(file.file_id, targetFolder);
      return;
    }

    // 选中模式：可将当前文件移出所选文件夹
    if (selectedFolderId) {
      if (file.folder_id !== selectedFolderId) {
        toast({ type: "error", description: "仅可移除当前文件夹的文件" });
        return;
      }
      if (!file.folder_id) {
        toast({ type: "info", description: "文件已无归属" });
        return;
      }
      await handleAddToFolder(file.file_id, null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">加载失败，请重试</div>
      </div>
    );
  }

  if (filteredFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          {searchQuery ? "未找到匹配的文件" : "暂无文件"}
        </div>
      </div>
    );
  }

  const fileIds = filteredFiles.map((f) => f.file_id);

  return (
    <SortableContext items={fileIds} strategy={rectSortingStrategy}>
      <div
        className={cn(
          "grid gap-2",
          viewMode === "grid"
            ? "grid-cols-1"
            : "grid-cols-1"
        )}
      >
        {filteredFiles.map((file) => {
          const { isSelected, isDimmed } = getFileState(file);
          return (
            <KnowledgeFileItem
              key={file.file_id}
              file={file}
              isSelected={isSelected}
              isDimmed={isDimmed}
              collectingFolderId={collectingFolderId}
              selectedFolderId={selectedFolderId}
              onToggleCollect={handleToggleCollect}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onAddToFolder={handleAddToFolder}
            />
          );
        })}
      </div>
    </SortableContext>
  );
}

