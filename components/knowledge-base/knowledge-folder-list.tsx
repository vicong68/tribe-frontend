"use client";

import { useMemo } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import useSWR, { useSWRConfig } from "swr";
import { KnowledgeFolderItem, type KnowledgeFolder } from "./knowledge-folder-item";
import { toast } from "../toast";
import { useState } from "react";

interface KnowledgeFolderListProps {
  selectedFolderId: string | null;
  collectingFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onToggleCollectMode: (folderId: string) => void;
  onBackgroundClick?: () => void;
  searchQuery: string;
}

/**
 * 文件夹列表组件
 * 展示所有文件夹，支持拖拽排序
 */
export function KnowledgeFolderList({
  selectedFolderId,
  collectingFolderId,
  onSelectFolder,
  onToggleCollectMode,
  onBackgroundClick,
  searchQuery,
}: KnowledgeFolderListProps) {
  const { mutate } = useSWRConfig();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 获取文件夹列表
  const { data: folders, isLoading, error } = useSWR<KnowledgeFolder[]>(
    "/api/knowledge-base/folders",
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch folders");
      return response.json();
    }
  );

  // 处理文件夹删除
  const handleDelete = async (folderId: string) => {
    if (!confirm("确定要删除这个文件夹吗？文件夹中的文件不会被删除，只是移出文件夹。")) {
      return;
    }

    try {
      const response = await fetch(`/api/knowledge-base/folders/${folderId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      // 刷新文件夹列表和文件列表
      mutate("/api/knowledge-base/folders");
      mutate("/api/knowledge-base/files");
      
      // 如果删除的是当前选中的文件夹，取消选中
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
      
      toast({
        type: "success",
        description: "文件夹已删除",
      });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "删除失败",
      });
    }
  };

  // 处理文件夹编辑
  const handleEdit = async (folderId: string) => {
    const folder = folders?.find((f) => f.folder_id === folderId);
    if (!folder) return;

    const newFolderName = prompt("请输入新文件夹名称：", folder.folder_name);
    if (!newFolderName || newFolderName.trim() === folder.folder_name) return;

    try {
      const response = await fetch(`/api/knowledge-base/folders/${folderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folder_name: newFolderName.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("更新失败");
      }

      // 刷新文件夹列表
      mutate("/api/knowledge-base/folders");
      
      toast({
        type: "success",
        description: "文件夹已重命名",
      });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "更新失败",
      });
    }
  };

  const { folderTree, hasChildrenMap } = useMemo(() => {
    if (!folders) return [];
    const normalized = searchQuery
      ? folders.filter((f) =>
          f.folder_name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : folders;

    const map = new Map<string | null, KnowledgeFolder[]>();
    normalized.forEach((f) => {
      const parent = f.parent_id ?? null;
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent)?.push(f);
    });

    const sortFn = (a: KnowledgeFolder, b: KnowledgeFolder) =>
      (a.parent_id ?? "").localeCompare(b.parent_id ?? "") ||
      a.folder_name.localeCompare(b.folder_name);

    map.forEach((list) => list.sort(sortFn));

    const hasChildrenMap = new Map<string, boolean>();
    map.forEach((children, parent) => {
      if (parent) {
        hasChildrenMap.set(parent, children.length > 0);
      }
    });

    const build = (
      parent: string | null,
      level: number
    ): Array<{ node: KnowledgeFolder; level: number }> => {
      const children = map.get(parent) || [];
      return children.flatMap((child) => {
        const current = { node: child, level };
        const shouldExpand = expanded.has(child.folder_id);
        if (!shouldExpand) return [current];
        return [current, ...build(child.folder_id, level + 1)];
      });
    };

    return {
      folderTree: build(null, 0),
      hasChildrenMap,
    };
  }, [folders, searchQuery, expanded]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 p-4">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 p-4">
        <div className="text-destructive text-sm">加载失败，请重试</div>
      </div>
    );
  }

  if (folderTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 p-4">
        <div className="text-muted-foreground text-sm">
          {searchQuery ? "未找到匹配的文件夹" : "暂无文件夹"}
        </div>
      </div>
    );
  }

  const folderIds = folderTree.map((f) => f.node.folder_id);

  const handleToggleExpand = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleCreateChild = async (parentId: string) => {
    const name = prompt("请输入子文件夹名称：");
    if (!name?.trim()) return;

    try {
      const response = await fetch("/api/knowledge-base/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folder_name: name.trim(),
          parent_id: parentId,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "创建失败");
      }

      mutate("/api/knowledge-base/folders");
      toast({
        type: "success",
        description: "子文件夹已创建",
      });
    } catch (err) {
      toast({
        type: "error",
        description: err instanceof Error ? err.message : "创建失败",
      });
    }
  };

  const handleMove = async (folderId: string) => {
    const target = prompt("移动到目标文件夹ID（留空则为根）：", "");
    const targetId = target?.trim() || null;
    if (targetId === folderId) {
      toast({ type: "error", description: "不能移动到自身" });
      return;
    }

    try {
      const response = await fetch(`/api/knowledge-base/folders/${folderId}/move`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent_id: targetId }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "移动失败");
      }

      mutate("/api/knowledge-base/folders");
      toast({
        type: "success",
        description: "文件夹已移动",
      });
    } catch (err) {
      toast({
        type: "error",
        description: err instanceof Error ? err.message : "移动失败",
      });
    }
  };

  return (
    <div
      className="p-2 space-y-1.5"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onBackgroundClick?.();
        }
      }}
    >
      <SortableContext items={folderIds} strategy={verticalListSortingStrategy}>
        {folderTree.map(({ node, level }) => (
          <KnowledgeFolderItem
            key={node.folder_id}
            folder={node}
            level={level}
            hasChildren={hasChildrenMap.get(node.folder_id) || false}
            isExpanded={expanded.has(node.folder_id)}
            isSelected={selectedFolderId === node.folder_id}
            isCollecting={collectingFolderId === node.folder_id}
            onSelect={onSelectFolder}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onCreateChild={handleCreateChild}
            onMove={handleMove}
            onToggleExpand={handleToggleExpand}
            onToggleCollect={() => onToggleCollectMode(node.folder_id)}
          />
        ))}
      </SortableContext>
    </div>
  );
}

