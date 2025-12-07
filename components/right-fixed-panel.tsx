"use client";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { useRightSidebar } from "@/components/right-sidebar-provider";
import { useEffect, useState } from "react";
import { RightSidebarToggle } from "@/components/right-sidebar-toggle";
import { CollectionsList } from "@/components/collections-list";

/**
 * 右侧知识库面板
 * 位于对话管理面板左侧
 * 宽度：主内容区域的36%（原30%的120%，取整）
 * 
 * 注意：这是知识库面板，不是对话管理面板（RightSidebar）
 */
export function RightFixedPanel() {
  const { state: leftState, isMobile } = useSidebar();
  const { state: rightState } = useRightSidebar();
  const [panelWidth, setPanelWidth] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    if (isMobile) {
      setPanelWidth(undefined);
      return;
    }
    
    // 知识库面板宽度：占据主内容区域的36% + 2*对话管理面板减少的宽度（2*4rem = 8rem）+ 2*本次增加的宽度（2*1rem = 2rem）+ 用户面板减少的宽度（3.84rem + 1.536rem）
    // 对话管理面板从 12rem 减少到 8rem，减少了 4rem，知识库面板宽度增加 2*4rem = 8rem
    // 对话管理面板从 8rem 增加到 9rem，增加了 1rem（y=1rem），知识库面板宽度增加 2*1rem = 2rem
    // 用户面板从 19.2rem 减少到 15.36rem，减少了 3.84rem（x=3.84rem），知识库面板宽度增加 3.84rem
    // 用户面板从 15.36rem 减少到 13.824rem，减少了 1.536rem（减少10%），知识库面板宽度增加 1.536rem
    // 主内容区域 = 100vw - 主面板宽度
    // 用户面板现在是独立弹出，不影响布局计算
    const leftSidebarWidth = "4rem"; // 主面板宽度
    
    // 主内容区域宽度
    const mainContentWidth = `calc(100vw - ${leftSidebarWidth})`;
    // 知识库面板 = 主内容区域 * 36% + 8rem（2*第一次减少的宽度）+ 2rem（2*本次增加的宽度y）+ 3.84rem（用户面板第一次减少的宽度）+ 1.536rem（用户面板第二次减少的宽度，减少10%）
    const knowledgeBasePanelWidth = `calc(${mainContentWidth} * 0.36 + 15.376rem)`;
    
    setPanelWidth(knowledgeBasePanelWidth);
    
    // 对话管理面板宽度：固定值 9rem（刚好适配三个图标：新对话+对话状态设置下拉+删除所有对话，确保删除图标完整显示）
    // 注意：这个宽度必须与 ConversationPanel 中的宽度一致
    // 知识库面板展开时左移的距离 = 对话管理面板宽度 = 9rem
    // 联动模式：两个面板协同随动
    // - 收缩时：对话管理面板完全隐藏（right: -9rem），知识库面板 right: 0（停靠页面最右端），仅暴露知识库面板
    // - 展开时：两个面板同时向左移动，移动距离 = 对话管理面板宽度 = 9rem，刚好露出知识库面板
    // 这样确保两个面板移动距离、速度一致，可以拼接两个面板，统一随动展开-折叠
    const CONVERSATION_PANEL_WIDTH = "9rem"; // 固定宽度，必须与 ConversationPanel 中的 PANEL_WIDTH 一致
    
    // 设置 CSS 变量供其他组件使用
    document.documentElement.style.setProperty("--right-knowledge-base-panel-width", knowledgeBasePanelWidth); // 知识库面板宽度
    // 设置对话管理面板宽度（等于知识库面板展开时左移距离）
    // 注意：ConversationPanel 也会设置这个变量，但这里先设置确保 RightFixedPanel 能正确读取
    document.documentElement.style.setProperty("--right-conversation-panel-width", CONVERSATION_PANEL_WIDTH);
    document.documentElement.style.setProperty("--right-conversation-panel-width-for-position", CONVERSATION_PANEL_WIDTH);
  }, [leftState, rightState, isMobile]);
  
  return (
    <div
      className={cn(
        "fixed top-0 z-40 h-screen",
        "bg-sidebar",
        // 对话管理面板展开时，移除左边框，确保紧凑排列
        rightState === "expanded" ? "border-l-0" : "border-l border-sidebar-border",
        "transition-all duration-200",
        "hidden md:block"
      )}
      style={{
        width: panelWidth,
        // 知识库面板位置：与对话管理面板协同随动（联动模式）
        // - 收缩时（rightState === "collapsed"）：对话管理面板完全隐藏，知识库面板 right: 0（停靠页面最右端）
        // - 展开时（rightState === "expanded"）：两个面板同时向左移动，移动距离 = 对话管理面板宽度
        //   知识库面板 right = 对话管理面板宽度（等于知识库面板展开时左移距离），紧贴对话管理面板左侧，无间距
        // 两个面板移动距离、速度一致，可以拼接两个面板，统一随动展开-折叠
        right: rightState === "collapsed" 
          ? "0" 
          : "9rem", // 对话管理面板宽度（固定值 9rem，等于知识库面板展开时左移距离）
        // 确保过渡动画平滑，与对话管理面板的动画时长一致（200ms）
        transition: "right 200ms ease-linear",
      } as React.CSSProperties}
    >
      <div className="flex h-full flex-col relative">
        {/* 对话管理面板切换按钮 - 位于知识库面板右上方 */}
        <div className="absolute right-2 top-4 z-50">
          <RightSidebarToggle />
        </div>
        
        {/* 知识库管理区域（上半部分，留空） */}
        <div className="flex-1 p-4 border-b border-sidebar-border">
          <div className="text-sm font-semibold mb-2">知识库管理</div>
          <div className="text-sm text-muted-foreground">
            {/* 预留空间，后续添加知识库管理功能 */}
          </div>
        </div>
        
        {/* 收藏/上下文管理区域（下半部分） */}
        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          <div className="text-sm font-semibold mb-2">收藏/上下文管理</div>
          <CollectionsList />
        </div>
      </div>
    </div>
  );
}
