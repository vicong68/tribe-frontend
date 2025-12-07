"use client";

import * as React from "react";

const RIGHT_SIDEBAR_COOKIE_NAME = "right_sidebar_state";
const RIGHT_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type RightSidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const RightSidebarContext = React.createContext<RightSidebarContextProps | null>(null);

export function useRightSidebar() {
  const context = React.useContext(RightSidebarContext);
  if (!context) {
    throw new Error("useRightSidebar must be used within a RightSidebarProvider.");
  }
  return context;
}

export function RightSidebarProvider({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [_open, _setOpen] = React.useState(defaultOpen);
  const [open, setOpenState] = React.useState(defaultOpen);

  React.useEffect(() => {
    // 从 cookie 读取初始状态
    const cookieValue = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${RIGHT_SIDEBAR_COOKIE_NAME}=`))
      ?.split("=")[1];
    
    if (cookieValue === "true" || cookieValue === "false") {
      setOpenState(cookieValue === "true");
    }
  }, []);

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      setOpenState(openState);
      // 保存到 cookie
      document.cookie = `${RIGHT_SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${RIGHT_SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [open]
  );

  // 切换右侧面板状态：控制知识库面板和对话管理面板的协同展开/折叠
  // - 展开时：对话管理面板向左展开，知识库面板向左滑动
  // - 折叠时：对话管理面板向右折叠，知识库面板向右滑动
  const toggleSidebar = React.useCallback(() => {
    setOpen((open) => !open);
  }, [setOpen]);

  const state = open ? "expanded" : "collapsed";

  // 设置 CSS 变量供其他组件使用
  React.useEffect(() => {
    document.documentElement.style.setProperty("--right-sidebar-state", state); // 对话管理面板状态
    // 右侧对话管理面板宽度：
    // - 展开时：使用 CSS 变量 --right-conversation-panel-width（等于知识库面板展开时左移的距离，即知识库面板宽度）
    // - 折叠时：0（offcanvas 模式：完全隐藏到页面右侧外，仅暴露知识库面板）
    // 联动模式：两个面板移动距离、速度一致，可以拼接两个面板，统一随动展开-折叠
    // 对话管理面板宽度由 RightFixedPanel 组件动态计算：等于知识库面板宽度
    const conversationPanelWidth = getComputedStyle(document.documentElement)
      .getPropertyValue("--right-conversation-panel-width")
      .trim() || "8rem";
    document.documentElement.style.setProperty("--right-sidebar-width", state === "expanded" ? conversationPanelWidth : "0"); // 对话管理面板宽度（用于知识库面板位置计算）
  }, [state]);

  const contextValue = React.useMemo<RightSidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      toggleSidebar,
    }),
    [state, open, setOpen, toggleSidebar]
  );

  return (
    <RightSidebarContext.Provider value={contextValue}>
      {children}
    </RightSidebarContext.Provider>
  );
}

