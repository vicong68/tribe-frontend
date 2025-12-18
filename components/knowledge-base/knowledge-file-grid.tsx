"use client";

import { useMemo, useEffect } from "react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import useSWR, { useSWRConfig } from "swr";
import { KnowledgeFileItem, type KnowledgeFile } from "./knowledge-file-item";
import { cn } from "@/lib/utils";
import { toast } from "../toast";
import { fileApi } from "@/lib/knowledge-base-api";
import { swrConfig } from "@/lib/swr-config";
import { useSSEMessageContext } from "@/components/websocket-message-provider";

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
  // 获取全局 mutate 函数用于刷新其他 key 的缓存
  const { mutate: mutateGlobal } = useSWRConfig();
  
  // ✅ 优化：使用SSE接收文件进度更新，减少轮询
  const { fileProgress, onFileProgress } = useSSEMessageContext();
  
  // 获取文件列表（优化：使用 folder_id 过滤，添加缓存和去重）
  const fileListKey = selectedFolderId 
    ? `/api/knowledge-base/files?folder_id=${selectedFolderId}`
    : "/api/knowledge-base/files";
  
  // ✅ 最佳实践：简化前端逻辑，统一使用 API 封装和配置
  // ✅ 优化：映射后端返回的数据格式，确保状态字段正确显示
  // ✅ 优化：结合SSE实时更新和轮询刷新，确保状态及时更新
  const { data: rawFiles, isLoading, error, mutate } = useSWR<any[]>(
    fileListKey,
    () => fileApi.list(selectedFolderId || null),
    {
      ...swrConfig,
      // ✅ 优化：降低轮询频率（SSE实时更新为主，轮询作为兜底）
      refreshInterval: 10000, // 10秒（SSE实时更新为主）
      // ✅ 修复：当窗口重新获得焦点时刷新
      revalidateOnFocus: true,
      // ✅ 修复：当网络重新连接时刷新
      revalidateOnReconnect: true,
    }
  );
  
  // ✅ 优化：监听SSE文件进度更新，自动刷新文件列表
  useEffect(() => {
    const unsubscribe = onFileProgress((progress) => {
      // 当收到文件进度更新时，刷新文件列表
      mutate();
      mutateGlobal("/api/knowledge-base/files");
    });
    return unsubscribe;
  }, [onFileProgress, mutate, mutateGlobal]);

  // ✅ 优化：映射后端数据到前端接口，确保状态字段正确
  const files = useMemo(() => {
    if (!rawFiles) return [];
    return rawFiles.map((file: any) => ({
      ...file,
      // ✅ 确保状态字段正确映射（后端返回status，前端使用status）
      // ✅ 修复：优先使用后端返回的status字段，如果没有则从vectorization_status推断
      status: file.status || (file.vectorization_status === "completed" ? "completed" : file.vectorization_status === "failed" ? "failed" : file.vectorization_status === "processing" ? "processing" : file.vectorization_status === "vectorized" ? "processing" : "pending"),
      // ✅ 确保上传状态正确（如果后端没有返回，默认为success）
      upload_status: file.upload_status || "success",
      // ✅ 确保其他字段正确映射
      file_size: file.size || file.file_size || 0,
      created_at: file.upload_date || file.created_at || new Date().toISOString(),
      upload_date: file.upload_date || file.created_at, // ✅ 入库时间
    })) as KnowledgeFile[];
  }, [rawFiles]);

  // ✅ 最佳实践：简化前端逻辑，所有验证由后端处理
  const handleDelete = async (fileId: string) => {
    try {
      await fileApi.delete(fileId);
      mutate(); // 刷新当前 key
      mutateGlobal("/api/knowledge-base/files"); // 刷新所有文件列表
      mutateGlobal("/api/knowledge-base/folders"); // 更新文件夹计数
      toast({ type: "success", description: "文件已删除" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "删除失败",
      });
    }
  };

  // ✅ 最佳实践：简化前端逻辑，验证由后端完成
  const handleEdit = async (fileId: string) => {
    const file = files?.find((f) => f.file_id === fileId);
    if (!file) return;

    const newFilename = prompt("请输入新文件名：", file.filename);
    if (!newFilename?.trim()) return;

    try {
      await fileApi.update(fileId, { filename: newFilename.trim() });
      mutate(); // 刷新当前 key
      mutateGlobal("/api/knowledge-base/files"); // 刷新所有文件列表
      toast({ type: "success", description: "文件信息已更新" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "更新失败",
      });
    }
  };

  // ✅ 最佳实践：简化前端逻辑，验证由后端完成
  const handleAddToFolder = async (fileId: string, folderId: string | null) => {
    try {
      await fileApi.update(fileId, { folder_id: folderId });
      mutate(); // 刷新当前 key
      mutateGlobal("/api/knowledge-base/files"); // 刷新所有文件列表
      mutateGlobal("/api/knowledge-base/folders"); // 更新文件夹计数
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
        // 文件已在该文件夹中，无需操作
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
        // 文件已无归属，无需操作
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
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
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
              viewMode={viewMode}
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

