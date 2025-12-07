"use client";

import Link from "next/link";
import type { User } from "next-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { UserProfileCard } from "@/components/user-profile-card";
import { FriendsList } from "@/components/friends-list";
import { SidebarHistory } from "@/components/sidebar-history";

export function AppSidebar({ user }: { user: User | undefined }) {
  return (
      <Sidebar className="group-data-[side=left]:border-r-0" collapsible="offcanvas">
      <SidebarHeader className="group-data-[collapsible=icon]:hidden pt-4 pb-6">
          <SidebarMenu>
              <Link
                className="flex flex-row items-center gap-3"
                href="/"
              >
                <span className="cursor-pointer rounded-md px-2 font-bold text-xl hover:bg-muted" style={{ fontSize: '1.15em' }}>
                  Tribe-Agents
                </span>
              </Link>
          </SidebarMenu>
        </SidebarHeader>
      <SidebarContent className="space-y-6 pt-0">
        {/* 用户详细信息模块 */}
        <UserProfileCard />
        
        {/* 好友列表模块 */}
        <FriendsList />
        
        {/* 对话历史已移动到右侧边栏 */}
        </SidebarContent>
      </Sidebar>
  );
}
