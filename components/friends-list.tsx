"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useChatModels, clearModelsCache } from "@/lib/ai/models-client";
import { getAvatarInfo, preloadAvatars } from "@/lib/avatar-utils";
import { getBackendMemberId } from "@/lib/user-utils";
import { useUserStatus } from "@/hooks/use-user-status";
import { cn } from "@/lib/utils";
import { BotIcon, UserIcon } from "./icons";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { FriendManager } from "./friend-manager";
import { UnifiedAvatar } from "./unified-avatar";

/**
 * 好友列表组件
 * 复用消息框下拉列表逻辑，稳定渲染：agents + 远端用户（登录状态）
 */
export function FriendsList() {
  const { data: session, status } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const [refreshKey, setRefreshKey] = useState(0);

  // 从后端获取模型列表（登录用户包含用户列表）
  const { models: chatModels, loading: modelsLoading } = useChatModels(isLoggedIn, refreshKey);

  // 用户状态管理（快速查询和SSE推送更新）
  const { fetchUserStatus, handleStatusUpdate, getCachedStatus } = useUserStatus({
    isLoggedIn,
    onStatusUpdate: useCallback((updates: Map<string, boolean>) => {
      // 当收到状态更新时，更新本地模型列表中的在线状态
      setRefreshKey((prev) => prev + 1);
    }, []),
  });

  // 分离 agents 和 users
  const availableAgents = useMemo(() => {
    return chatModels.filter((chatModel) => chatModel.type === "agent");
  }, [chatModels]);

  const availableUsers = useMemo(() => {
    if (!isLoggedIn) return [];
    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) return [];
    
    return chatModels.filter((chatModel) => {
      if (chatModel.type !== "user") return false;
      // 排除当前用户
      const chatModelMemberId = chatModel.id.replace(/^user::/, "");
      return chatModel.id !== `user::${currentUserId}` && 
             chatModelMemberId !== currentUserId;
    });
  }, [chatModels, isLoggedIn, session]);

  // 预加载所有模型的头像信息，并更新用户在线状态（从缓存）
  const modelsWithAvatars = useMemo(() => {
    const allModels = [...availableAgents, ...availableUsers];
    const models = preloadAvatars(allModels);
    // 更新用户在线状态（从缓存）
    return models.map((model) => {
      if (model.type === "user") {
        const cachedStatus = getCachedStatus(model.id);
        if (cachedStatus !== undefined) {
          return { ...model, isOnline: cachedStatus };
        }
      }
      return model;
    });
  }, [availableAgents, availableUsers, getCachedStatus]);

  // 组件挂载时刷新用户状态
  useEffect(() => {
    if (isLoggedIn && availableUsers.length > 0) {
      fetchUserStatus().then((statusMap) => {
        if (statusMap.size > 0) {
          handleStatusUpdate(statusMap);
        }
      });
    }
  }, [isLoggedIn, availableUsers.length, fetchUserStatus, handleStatusUpdate]);

  // 监听好友更新事件（SSE推送）
  useEffect(() => {
    if (!isLoggedIn) return;

    const handleFriendUpdate = () => {
      // 刷新好友列表
      setRefreshKey((prev) => prev + 1);
    };

    const handleUserStatusUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { member_id, is_online } = customEvent.detail;
      if (member_id) {
        // 更新用户状态缓存
        const updates = new Map<string, boolean>();
        updates.set(member_id, is_online);
        updates.set(`user::${member_id}`, is_online);
        handleStatusUpdate(updates);
        // 刷新列表以显示最新状态
        setRefreshKey((prev) => prev + 1);
      }
    };

    window.addEventListener("sse_friend_update", handleFriendUpdate);
    window.addEventListener("sse_user_status_update", handleUserStatusUpdate);

    return () => {
      window.removeEventListener("sse_friend_update", handleFriendUpdate);
      window.removeEventListener("sse_user_status_update", handleUserStatusUpdate);
    };
  }, [isLoggedIn, handleStatusUpdate]);

  // 加载中状态（包括 session 加载和 models 加载）
  // 统一处理加载状态，避免服务器端和客户端渲染不一致导致的 hydration 错误
  if (status === "loading" || modelsLoading) {
    return (
      <Card className="border-0 shadow-none bg-sidebar">
        <CardHeader>
          <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">好友列表</CardTitle>
            <div className="h-8 w-8" /> {/* 占位符，保持布局一致 */}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 未登录状态（仅在确认未登录后显示）
  if (!isLoggedIn) {
    return (
      <Card className="border-0 shadow-none bg-sidebar">
        <CardHeader>
          <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">好友列表</CardTitle>
            <div className="h-8 w-8" /> {/* 占位符，保持布局一致 */}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 text-sm text-muted-foreground">
            请登录后查看好友列表
          </div>
        </CardContent>
      </Card>
    );
  }

  const agentsWithAvatars = modelsWithAvatars.filter((m) => m.type === "agent");
  const usersWithAvatars = modelsWithAvatars.filter((m) => m.type === "user");

  return (
    <Card className="border-0 shadow-none bg-sidebar">
      <CardHeader>
        <div className="flex items-center justify-between">
        <CardTitle className="text-sm font-semibold">好友列表</CardTitle>
          <FriendManager
            onRefresh={() => {
              setRefreshKey((prev) => prev + 1);
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[700px]">
          <div className="p-4 pr-6 space-y-3">
            {/* Agents 列表 */}
            {agentsWithAvatars.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                  智能体
                </div>
                {agentsWithAvatars.map((model) => {
                  const hasDescription = model.description && model.description.trim().length > 0;
                  
                  const agentItem = (
                    <div
                      className={cn(
                        "flex items-center gap-3 px-2 py-2 rounded-lg",
                        "hover:bg-sidebar-accent cursor-pointer transition-colors"
                      )}
                    >
                      <UnifiedAvatar
                        name={model.name}
                        id={model.id}
                        isAgent={true}
                        size={8}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium truncate">{model.name}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          在线
                        </div>
                      </div>
                    </div>
                  );

                  // 如果有介绍，使用 Tooltip 包裹
                  if (hasDescription) {
                    return (
                      <TooltipProvider key={model.id} delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {agentItem}
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="max-w-[280px] p-3 text-sm leading-relaxed"
                            sideOffset={8}
                          >
                            <div className="font-medium mb-1.5">{model.name}</div>
                            <div className="text-muted-foreground whitespace-pre-wrap break-words">
                              {model.description}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }

                  // 没有介绍，直接返回
                  return <div key={model.id}>{agentItem}</div>;
                })}
              </div>
            )}

            {/* Users 列表 */}
            {usersWithAvatars.length > 0 && (
              <>
                {agentsWithAvatars.length > 0 && <Separator className="my-3" />}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                    用户
                  </div>
                  {usersWithAvatars.map((model) => {
                    // 判断是否是当前用户（本地用户不显示状态）
                    const isModelCurrentUser = (() => {
                      if (!isLoggedIn || !session?.user) return false;
                      const currentUserId = getBackendMemberId(session.user);
                      if (!currentUserId) return false;
                      const modelMemberId = model.id.replace(/^user::/, "");
                      return modelMemberId === currentUserId;
                    })();
                    
                    return (
                      <div
                        key={model.id}
                        className={cn(
                          "flex items-center gap-3 px-2 py-2 rounded-lg",
                          "hover:bg-sidebar-accent cursor-pointer transition-colors"
                        )}
                      >
                        <UnifiedAvatar
                          name={model.name}
                          id={model.id}
                          isAgent={false}
                          size={8}
                          showStatus={!isModelCurrentUser}
                          isOnline={model.isOnline}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium truncate">{model.name}</div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {model.isOnline === true
                              ? "在线"
                              : model.isOnline === false
                              ? "离线"
                              : "状态未知"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 空状态 */}
            {agentsWithAvatars.length === 0 && usersWithAvatars.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                暂无好友
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

