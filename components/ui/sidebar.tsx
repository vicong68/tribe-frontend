"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import { Slot as SlotPrimitive } from "radix-ui";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "13.824rem"; // 减少10%：15.36rem * 0.9 = 13.824rem（减少了1.536rem）
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
// 右侧对话管理面板宽度：固定值 9rem（刚好适配三个图标：新对话+对话状态设置下拉+删除所有对话，确保删除图标完整显示）
// 注意：这是对话管理面板（RightSidebar）的宽度，不是知识库面板（RightFixedPanel）的宽度
// 实际宽度由 ConversationPanel 组件设置到 CSS 变量 --right-conversation-panel-width
// 对话管理面板使用 offcanvas 模式，展开时平移向左弹出，收缩时平移向右隐藏
const RIGHT_CONVERSATION_PANEL_WIDTH = "9rem"; // 固定值 9rem

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      className,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(false);

    // This is the internal state of the sidebar.
    // We use openProp and setOpenProp for control from outside the component.
    const [_open, _setOpen] = React.useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
      (value: boolean | ((value: boolean) => boolean)) => {
        const openState = typeof value === "function" ? value(open) : value;
        if (setOpenProp) {
          setOpenProp(openState);
        } else {
          _setOpen(openState);
        }

        // This sets the cookie to keep the sidebar state.
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      },
      [setOpenProp, open]
    );

    // Helper to toggle the sidebar.
    const toggleSidebar = React.useCallback(() => {
      return isMobile
        ? setOpenMobile((open) => !open)
        : setOpen((open) => !open);
    }, [isMobile, setOpen, setOpenMobile]);

    // Adds a keyboard shortcut to toggle the sidebar.
    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          toggleSidebar();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleSidebar]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? "expanded" : "collapsed";

    // 设置 CSS 变量，供 SidebarInset 等组件使用，实现聊天区域随动
    React.useEffect(() => {
      document.documentElement.style.setProperty("--left-sidebar-state", state);
      document.documentElement.style.setProperty("--left-sidebar-width", "4rem");
      document.documentElement.style.setProperty("--sidebar-width", SIDEBAR_WIDTH);
      document.documentElement.style.setProperty("--sidebar-width-icon", SIDEBAR_WIDTH_ICON);
    }, [state]);

    const contextValue = React.useMemo<SidebarContextProps>(
      () => ({
        state,
        open,
        setOpen,
        isMobile,
        openMobile,
        setOpenMobile,
        toggleSidebar,
      }),
      [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <div
            className={cn(
              "group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
              className
            )}
            ref={ref}
            style={
              {
                "--left-sidebar-width": "4rem",
                "--sidebar-width": SIDEBAR_WIDTH,
                "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                "--content-gap": "1rem",
                "--chat-max-width": "56rem",
                "--right-sidebar-width": SIDEBAR_WIDTH,
                "--right-sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                "--right-conversation-panel-width": RIGHT_CONVERSATION_PANEL_WIDTH, // 对话管理面板宽度（等于知识库面板展开时左移宽度）
                ...style,
              } as React.CSSProperties
            }
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  }
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      children,
      ...props
    },
    ref
  ) => {
    // 左侧边栏：使用左侧边栏的状态（通过 SidebarProvider）
    // 右侧边栏：尝试从 RightSidebarProvider 读取状态，如果不可用则使用默认值
    const leftSidebar = useSidebar();
    
    // 尝试获取右侧边栏状态
    let rightSidebarState: "expanded" | "collapsed" = "expanded";
    if (side === "right") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useRightSidebar } = require("@/components/right-sidebar-provider");
        const rightSidebar = useRightSidebar();
        rightSidebarState = rightSidebar.state;
      } catch {
        // 如果不在 RightSidebarProvider 内，使用默认值
        rightSidebarState = "expanded";
      }
    }
    
    // 左侧边栏：使用左侧状态；右侧边栏：使用右侧状态
    const state = side === "left" ? leftSidebar.state : rightSidebarState;
    const isMobile = leftSidebar.isMobile;
    const openMobile = leftSidebar.openMobile;
    const setOpenMobile = leftSidebar.setOpenMobile;

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-foreground",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isMobile) {
      return (
        <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
          <SheetContent
            className="w-[var(--sidebar-width)] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
            data-mobile="true"
            data-sidebar="sidebar"
            side={side}
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Sidebar</SheetTitle>
              <SheetDescription>Displays the mobile sidebar.</SheetDescription>
            </SheetHeader>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <div
        className="group peer hidden text-sidebar-foreground md:block"
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-side={side}
        data-state={state}
        data-variant={variant}
        ref={ref}
        style={
          side === "right"
            ? {
                "--right-sidebar-state": state,
              } as React.CSSProperties
            : undefined
        }
      >
        {/* 左侧边栏：独立弹出，不占用布局空间 */}
        {side === "left" ? (
          // 左侧边栏：移除gap div，使其完全独立弹出
          null
        ) : (
          // 右侧边栏：移除gap div，使其完全独立弹出（与左侧边栏一致）
          null
        )}
        <div
          className={cn(
            "fixed inset-y-0 hidden h-svh transition-[left,right,width] duration-200 ease-linear md:flex",
            // 左侧边栏：独立弹出，z-index低于固定栏，叠加在背景上
            // 折叠时（offcanvas模式）：完全隐藏到左侧固定栏左侧（负值，完全移出视野）
            side === "left"
              ? "z-50 w-[var(--sidebar-width)] left-[var(--left-sidebar-width,4rem)] group-data-[collapsible=offcanvas]:left-[calc(var(--left-sidebar-width,4rem)_-_var(--sidebar-width))]"
              : "z-10 w-[var(--right-conversation-panel-width, var(--sidebar-width))] right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--right-conversation-panel-width, var(--sidebar-width))*-1)]", // 对话管理面板：展开时 right-0（对齐页面最右端），收缩时 right: -width（完全隐藏）
            // Adjust the padding for floating and inset variants.
            variant === "floating" || variant === "inset"
              ? side === "left"
              ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
                : "p-2"
              : side === "left"
                ? "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]"
                : "", // 右侧边栏使用 offcanvas 模式，无需 icon 模式宽度
            className
          )}
          {...props}
        >
          <div
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
            data-sidebar="sidebar"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
);
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("h-7 w-7", className)}
      data-sidebar="trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      ref={ref}
      size="icon"
      variant="ghost"
      {...props}
    >
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button">
>(({ className, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      aria-label="切换侧边栏"
      className={cn(
        "-translate-x-1/2 group-data-[side=left]:-right-4 absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=right]:left-0 sm:flex",
        "[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:hover:bg-sidebar group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      data-sidebar="rail"
      onClick={toggleSidebar}
      ref={ref}
      tabIndex={-1}
      title="切换侧边栏"
      {...props}
    />
  );
});
SidebarRail.displayName = "SidebarRail";

const SidebarInset = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"main">
>(({ className, style, ...props }, ref) => {
  const { state: leftState, isMobile } = useSidebar();
  
  // 获取右侧对话管理面板的状态
  let rightState: "expanded" | "collapsed" = "collapsed";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useRightSidebar } = require("@/components/right-sidebar-provider");
    const rightSidebar = useRightSidebar();
    rightState = rightSidebar.state;
  } catch {
    // 如果不在 RightSidebarProvider 内，使用默认值
  }
  
  // 聊天区域随动计算：跟随左右面板折叠/展开进行随动渲染
  // 1. 主面板（左侧固定边栏）：left: 0, width: 4rem (--left-sidebar-width)
  // 2. 左侧用户面板（可折叠边栏）：展开时 width: 13.824rem，折叠时 width: 0
  //    通过 CSS 变量 --sidebar-width 和 --sidebar-width-icon 控制
  // 3. 右侧知识库面板：width 动态计算（主内容区域的36%），right 位置随对话管理面板状态变化
  // 4. 右侧对话管理面板：宽度等于知识库面板展开时左移的距离（即知识库面板宽度），使用 offcanvas 模式
  //    联动模式：收缩时完全隐藏，仅暴露知识库面板；展开时两个面板同时向左移动，移动距离、速度一致
  //    通过 CSS 变量 --right-conversation-panel-width 控制（由 RightFixedPanel 组件动态计算）
  // 
  // 聊天区域可见宽度 = 100vw - 主面板宽度 - 用户面板宽度 - 右侧知识库面板宽度 - 右侧对话管理面板宽度
  // 聊天区域在这个可见宽度内使用 mx-auto 和 max-w-4xl 居中显示
  
  // 左侧内边距 = 主面板宽度 + 用户面板宽度（展开时）
  const leftSidebarWidth = leftState === "collapsed" 
    ? "var(--sidebar-width-icon, 3rem)" 
    : "var(--sidebar-width, 13.824rem)";
  const paddingLeft = !isMobile
    ? `calc(var(--left-sidebar-width, 4rem) + ${leftSidebarWidth})`
    : undefined;
  
  // 右侧内边距计算：
  // - 展开时：右侧知识库面板宽度 + 右侧对话管理面板宽度
  // - 收缩时：仅右侧知识库面板宽度（对话管理面板完全隐藏，不占用空间）
  // 右侧知识库面板宽度通过 CSS 变量 --right-knowledge-base-panel-width 传递（主内容区域的36%）
  // 右侧对话管理面板宽度：展开时从 --right-conversation-panel-width 读取（等于知识库面板展开时左移距离），折叠时 0（offcanvas 模式：完全隐藏）
  const rightConversationPanelWidth = rightState === "collapsed" 
    ? "0" // offcanvas 模式：折叠时完全隐藏，不占用空间，仅暴露知识库面板
    : "var(--right-conversation-panel-width, 9rem)"; // 从CSS变量读取完整宽度（对话管理面板，等于知识库面板展开时左移距离）
  const paddingRight = !isMobile
    ? rightState === "collapsed"
      ? "var(--right-knowledge-base-panel-width, 0px)" // 收缩时：仅知识库面板宽度
      : `calc(var(--right-knowledge-base-panel-width, 0px) + ${rightConversationPanelWidth})` // 展开时：知识库面板 + 对话管理面板
    : undefined;
  
  return (
    <main
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        "md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
        className
      )}
      ref={ref}
      style={{
        ...(paddingLeft && { paddingLeft }),
        ...(paddingRight && { paddingRight }),
        ...style,
      } as React.CSSProperties}
      {...props}
    />
  );
});
SidebarInset.displayName = "SidebarInset";

const SidebarInput = React.forwardRef<
  React.ElementRef<typeof Input>,
  React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => {
  return (
    <Input
      className={cn(
        "h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className
      )}
      data-sidebar="input"
      ref={ref}
      {...props}
    />
  );
});
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      ref={ref}
      {...props}
    />
  );
});
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      ref={ref}
      {...props}
    />
  );
});
SidebarFooter.displayName = "SidebarFooter";

const SidebarSeparator = React.forwardRef<
  React.ElementRef<typeof Separator>,
  React.ComponentProps<typeof Separator>
>(({ className, ...props }, ref) => {
  return (
    <Separator
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      data-sidebar="separator"
      ref={ref}
      {...props}
    />
  );
});
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      data-sidebar="content"
      ref={ref}
      {...props}
    />
  );
});
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      data-sidebar="group"
      ref={ref}
      {...props}
    />
  );
});
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? SlotPrimitive.Slot : "div";

  return (
    <Comp
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 font-medium text-sidebar-foreground/70 text-xs outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      data-sidebar="group-label"
      ref={ref}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? SlotPrimitive.Slot : "button";

  return (
    <Comp
      className={cn(
        "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:-inset-2 after:absolute after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-sidebar="group-action"
      ref={ref}
      {...props}
    />
  );
});
SidebarGroupAction.displayName = "SidebarGroupAction";

const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  <div
    className={cn("w-full text-sm", className)}
    data-sidebar="group-content"
    ref={ref}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    data-sidebar="menu"
    ref={ref}
    {...props}
  />
));
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li
    className={cn("group/menu-item relative", className)}
    data-sidebar="menu-item"
    ref={ref}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "group-data-[collapsible=icon]:!p-0 h-12 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  } & VariantProps<typeof sidebarMenuButtonVariants>
>(
  (
    {
      asChild = false,
      isActive = false,
      variant = "default",
      size = "default",
      tooltip,
      className,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? SlotPrimitive.Slot : "button";
    const { isMobile, state } = useSidebar();

    const button = (
      <Comp
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        data-active={isActive}
        data-sidebar="menu-button"
        data-size={size}
        ref={ref}
        {...props}
      />
    );

    if (!tooltip) {
      return button;
    }

    if (typeof tooltip === "string") {
      tooltip = {
        children: tooltip,
      };
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          align="center"
          hidden={state !== "collapsed" || isMobile}
          side="right"
          {...tooltip}
        />
      </Tooltip>
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    showOnHover?: boolean;
  }
>(({ className, asChild = false, showOnHover = false, ...props }, ref) => {
  const Comp = asChild ? SlotPrimitive.Slot : "button";

  return (
    <Comp
      className={cn(
        "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:-inset-2 after:absolute after:md:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
        className
      )}
      data-sidebar="menu-action"
      ref={ref}
      {...props}
    />
  );
});
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  <div
    className={cn(
      "pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 font-medium text-sidebar-foreground text-xs tabular-nums",
      "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
      "peer-data-[size=sm]/menu-button:top-1",
      "peer-data-[size=default]/menu-button:top-1.5",
      "peer-data-[size=lg]/menu-button:top-2.5",
      "group-data-[collapsible=icon]:hidden",
      className
    )}
    data-sidebar="menu-badge"
    ref={ref}
    {...props}
  />
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    showIcon?: boolean;
  }
>(({ className, showIcon = false, ...props }, ref) => {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  }, []);

  return (
    <div
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      data-sidebar="menu-skeleton"
      ref={ref}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

const SidebarMenuSub = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    className={cn(
      "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
      "group-data-[collapsible=icon]:hidden",
      className
    )}
    data-sidebar="menu-sub"
    ref={ref}
    {...props}
  />
));
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ ...props }, ref) => <li ref={ref} {...props} />);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    asChild?: boolean;
    size?: "sm" | "md";
    isActive?: boolean;
  }
>(({ asChild = false, size = "md", isActive, className, ...props }, ref) => {
  const Comp = asChild ? SlotPrimitive.Slot : "a";

  return (
    <Comp
      className={cn(
        "-translate-x-px flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-active={isActive}
      data-sidebar="menu-sub-button"
      data-size={size}
      ref={ref}
      {...props}
    />
  );
});
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
