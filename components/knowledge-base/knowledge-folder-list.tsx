"use client";

import { useMemo } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import useSWR, { useSWRConfig } from "swr";
import { KnowledgeFolderItem, type KnowledgeFolder } from "./knowledge-folder-item";
import { toast } from "../toast";
import { useState } from "react";
import { folderApi } from "@/lib/knowledge-base-api";
import { swrConfig } from "@/lib/swr-config";

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
  // 获取全局 mutate 函数用于刷新其他 key 的缓存
  const { mutate: mutateGlobal } = useSWRConfig();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ✅ 最佳实践：简化前端逻辑，统一使用 API 封装和配置
  const { data: folders, isLoading, error, mutate } = useSWR<KnowledgeFolder[]>(
    "/api/knowledge-base/folders",
    folderApi.list,
    swrConfig
  );

  // ✅ 最佳实践：简化前端逻辑，所有验证和错误处理由后端完成
  const handleDelete = async (folderId: string) => {
    if (!confirm("确定要删除这个文件夹吗？文件夹中的文件不会被删除，只是移出文件夹。")) {
      return;
    }

    try {
      await folderApi.delete(folderId);
      // 统一刷新：后端操作成功后自动刷新相关数据
      mutate(); // 刷新当前 key
      mutateGlobal("/api/knowledge-base/files"); // 刷新文件列表
      
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
      
      toast({ type: "success", description: "文件夹已删除" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "删除失败",
      });
    }
  };

  // ✅ 最佳实践：简化前端逻辑，验证由后端完成
  const handleEdit = async (folderId: string) => {
    const folder = folders?.find((f) => f.folder_id === folderId);
    if (!folder) return;

    const newFolderName = prompt("请输入新文件夹名称：", folder.folder_name);
    if (!newFolderName?.trim()) return;

    try {
      await folderApi.update(folderId, newFolderName.trim());
      mutate(); // 刷新当前 key
      toast({ type: "success", description: "文件夹已重命名" });
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
      await folderApi.create(name.trim(), parentId);
      mutate(); // 刷新当前 key
      toast({ type: "success", description: "文件夹已创建" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "创建失败",
      });
    }
  };

  // ✅ 最佳实践：简化前端逻辑，所有验证由后端处理
  const handleMove = async (folderId: string) => {
    const target = prompt("移动到目标文件夹ID（留空则为根）：", "");
    const targetId = target?.trim() || null;

    try {
      // 后端会自动验证：不能移动到自身、循环检测、层级深度等
      await folderApi.move(folderId, targetId);
      mutate(); // 刷新当前 key
      toast({ type: "success", description: "文件夹已移动" });
    } catch (error) {
      toast({
        type: "error",
        description: error instanceof Error ? error.message : "移动失败",
      });
    }
  };

  return (
    <div
      className="p-2"
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

