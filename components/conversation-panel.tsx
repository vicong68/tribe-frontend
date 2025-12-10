"use client";

import type { User } from "next-auth";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ChevronDown } from "lucide-react";
import { useRightSidebar } from "@/components/right-sidebar-provider";
import { SidebarHistory } from "@/components/sidebar-history";
import { CollectionsList, CollectionsToolbar } from "@/components/collections-list";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * 对话管理面板（全新实现）
 * 
 * 需求：
 * 1. 宽度：固定值 12rem（192px），确保对话管理内容正常显示
 * 2. 位置：固定在页面右侧，使用 offcanvas 模式
 *    - 展开时：right: 0（对齐页面最右端）
 *    - 收缩时：right: -12rem（完全隐藏到页面右侧外）
 * 3. 联动模式：与知识库面板协同随动
 *    - 收缩时：完全隐藏，仅暴露知识库面板
 *    - 展开时：两个面板同时向左移动，移动距离 = 对话管理面板宽度
 * 4. 动画：200ms ease-linear，与知识库面板一致
 * 
 * 注意：这是全新的实现，不依赖 Sidebar 组件，确保所有属性都能正确生效
 */
export function ConversationPanel({ user }: { user: User | undefined }) {
  const { state } = useRightSidebar();
  const [mounted, setMounted] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // 确保客户端挂载后再渲染，避免 hydration 问题
  useEffect(() => {
    setMounted(true);
  }, []);

  // 对话管理面板宽度：固定值 9rem（刚好适配三个图标：新对话+对话状态设置下拉+删除所有对话，确保删除图标完整显示）
  // 注意：这个宽度必须与 RightFixedPanel 中的宽度一致，确保知识库面板的左移距离正确
  const PANEL_WIDTH = "9rem";

  // 设置 CSS 变量供其他组件使用
  // 注意：必须在 mounted 后立即设置，确保 RightFixedPanel 能正确读取
  useEffect(() => {
    if (mounted) {
      // 立即设置 CSS 变量，确保其他组件能正确读取
      document.documentElement.style.setProperty("--right-conversation-panel-width", PANEL_WIDTH);
      document.documentElement.style.setProperty("--right-sidebar-state", state);
    }
  }, [mounted, state, PANEL_WIDTH]);

  const isExpanded = state === "expanded";

  const defaultOrder = useMemo(() => ["history", "collections"], []);
  const [moduleOrder, setModuleOrder] = useState<string[]>(defaultOrder);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    history: false,
    collections: false,
  });

  // 读取本地偏好
  useEffect(() => {
    if (!mounted) return;
    try {
      const savedOrder = localStorage.getItem("conv-mod-order");
      const savedCollapsed = localStorage.getItem("conv-mod-collapsed");
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
          setModuleOrder(parsed);
        }
      }
      if (savedCollapsed) {
        const parsed = JSON.parse(savedCollapsed);
        if (parsed && typeof parsed === "object") {
          setCollapsed((prev) => ({ ...prev, ...parsed }));
        }
      }
    } catch {
      // 忽略本地存储解析错误
    }
  }, [mounted]);

  // 持久化
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("conv-mod-order", JSON.stringify(moduleOrder));
    localStorage.setItem("conv-mod-collapsed", JSON.stringify(collapsed));
  }, [moduleOrder, collapsed, mounted]);

  const modules = useMemo(
    () => ({
      history: {
        title: "对话历史",
        content: <SidebarHistory user={user} />,
      },
      collections: {
        title: "收藏消息",
        content: <CollectionsList />,
      },
    }),
    [user]
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setModuleOrder((items) => {
      const oldIndex = items.indexOf(active.id as string);
      const newIndex = items.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderModule = (id: string) => {
    const data = modules[id as keyof typeof modules];
    if (!data) return null;
    const isCollapsed = collapsed[id];
    // 为收藏消息模块添加工具栏
    const toolbar = id === "collections" ? <CollectionsToolbar /> : undefined;
    return (
      <SortableModule
        key={id}
        id={id}
        title={data.title}
        collapsed={isCollapsed}
        onToggle={() => toggleCollapsed(id)}
        toolbar={toolbar}
      >
        {!isCollapsed && <div className="flex-1 min-h-0 overflow-hidden">{data.content}</div>}
      </SortableModule>
    );
  };

  const placeholderContent = (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-2 pt-4">
        <div className="px-2 py-1 text-sm font-semibold text-sidebar-foreground">
          对话收藏管理
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-1 py-1">
        <div className="h-24 rounded-md border border-sidebar-border bg-sidebar/60" />
        <div className="h-24 rounded-md border border-sidebar-border bg-sidebar/60" />
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex h-full w-full flex-col">
      {/* 面板头部 */}
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-2 pt-4">
        <div className="px-2 py-1 text-sm font-semibold text-sidebar-foreground">
          对话收藏管理
        </div>
      </div>

      {/* 面板内容：可拖拽 + 折叠 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={moduleOrder} strategy={verticalListSortingStrategy}>
            <div className="flex min-h-0 flex-1 flex-col gap-1 px-1 py-1">
              {moduleOrder.map(renderModule)}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "fixed inset-y-0 z-10 h-screen",
        "bg-sidebar",
        "transition-all duration-200 ease-linear",
        "hidden md:block"
      )}
      style={{
        width: PANEL_WIDTH,
        // 展开时：right: 0（对齐页面最右端）
        // 收缩时：right: -9rem（完全隐藏到页面右侧外）
        right: isExpanded ? "0" : `-${PANEL_WIDTH}`,
      } as React.CSSProperties}
    >
      {mounted ? mainContent : placeholderContent}
    </div>
  );
}

interface SortableModuleProps {
  id: string;
  title: string;
  collapsed?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  toolbar?: React.ReactNode; // 可选的工具栏（显示在标题栏下方）
}

function SortableModule({ id, title, collapsed = false, onToggle, children, toolbar }: SortableModuleProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex min-h-0 flex-col rounded-md border border-sidebar-border bg-sidebar/80 shadow-sm",
        isDragging && "ring-1 ring-primary shadow-md"
      )}
    >
      <div className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-sidebar-foreground/80">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0 text-muted-foreground"
          onClick={onToggle}
          aria-label="折叠/展开"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              collapsed ? "-rotate-90" : "rotate-0"
            )}
          />
        </Button>
        <div className="truncate font-medium">{title}</div>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0 text-muted-foreground cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="拖拽调整位置"
          >
            <GripVertical className="size-3" />
          </Button>
        </div>
      </div>
      {!collapsed && toolbar && (
        <div className="border-b border-sidebar-border px-1.5 py-0.5">
          {toolbar}
        </div>
      )}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden px-1 pb-1 max-h-[50vh]">
          {children}
        </div>
      )}
    </div>
  );
}

