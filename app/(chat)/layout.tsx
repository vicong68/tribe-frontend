import { cookies } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import Script from "next/script";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { LeftSidebar } from "@/components/left-sidebar";
import { RightFixedPanel } from "@/components/right-fixed-panel";
import { RightSidebar } from "@/components/right-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { WebSocketMessageProvider } from "@/components/websocket-message-provider";
import { SessionTimeoutProvider } from "@/components/session-timeout-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "../(auth)/auth";
import { RightSidebarProvider } from "@/components/right-sidebar-provider";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="beforeInteractive"
      />
      <DataStreamProvider>
        <WebSocketMessageProvider>
          <SessionTimeoutProvider>
          <Suspense fallback={<div className="flex h-dvh" />}>
            <SidebarWrapper>{children}</SidebarWrapper>
          </Suspense>
          </SessionTimeoutProvider>
        </WebSocketMessageProvider>
      </DataStreamProvider>
    </>
  );
}

async function SidebarWrapper({ children }: { children: React.ReactNode }) {
  // 标记为动态渲染，避免预渲染时 headers() 错误
  noStore();
  
  let session = null;
  let isCollapsed = false;
  
  try {
    session = await auth();
  } catch (error) {
    // 检查是否是预渲染错误
    if (error instanceof Error && (error.message.includes("prerender") || error.message.includes("HANGING_PROMISE_REJECTION"))) {
      // 预渲染阶段，跳过认证，使用默认值
      console.debug("[layout] Prerendering, skipping auth");
    } else {
      console.error("[layout] Failed to get session:", error);
    }
    // 继续执行，使用 null session（会显示为 guest）
  }
  
  try {
    const cookieStore = await cookies();
    isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";
  } catch (error) {
    // 如果 cookies() 也失败（预渲染阶段），使用默认值
    if (error instanceof Error && (error.message.includes("prerender") || error.message.includes("HANGING_PROMISE_REJECTION"))) {
      console.debug("[layout] Prerendering, using default sidebar state");
    } else {
      console.error("[layout] Failed to get cookies:", error);
    }
    // 使用默认值（展开状态）
    isCollapsed = false;
  }

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <RightSidebarProvider>
        <LeftSidebar />
      <AppSidebar user={session?.user} />
      <SidebarInset>{children}</SidebarInset>
        <RightFixedPanel />
        <RightSidebar user={session?.user} />
      </RightSidebarProvider>
    </SidebarProvider>
  );
}
