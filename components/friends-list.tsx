"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useAgents, useUsers } from "@/lib/ai/models-client";
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
import { Button } from "./ui/button";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

/**
 * 好友列表组件
 * 复用消息框下拉列表逻辑，稳定渲染：agents + 远端用户（登录状态）
 */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface PendingFriendRequest {
  id: string;
  from_user_id: string;
  from_nickname: string;
  from_avatar_icon: string;
  to_user_id: string;
  status: string;
  created_at?: string;
}

interface FriendsListResponse {
  success: boolean;
  friends: any[];
  pending_requests: PendingFriendRequest[];
}

export function FriendsList() {
  const { data: session, status } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const [refreshKey, setRefreshKey] = useState(0);
  const { mutate: globalMutate } = useSWRConfig();
  
  // ✅ 获取待处理的好友请求
  const currentUserId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : null;
  const { data: friendsData, mutate: mutateFriends } = useSWR<FriendsListResponse>(
    currentUserId ? `${BACKEND_URL}/api/friends?user_id=${currentUserId}` : null,
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("获取好友列表失败");
      return response.json();
    },
    {
      // ✅ 性能优化：减少轮询频率，使用智能刷新策略
      refreshInterval: 30000, // 30秒刷新一次（降低服务器压力）
      revalidateOnFocus: true, // 窗口聚焦时刷新
      revalidateOnReconnect: true, // 网络重连时刷新
      dedupingInterval: 5000, // 5秒内的重复请求会被去重
    }
  );
  
  const pendingRequests = friendsData?.pending_requests || [];

  // ✅ 性能优化：分离获取智能体和用户列表
  // 智能体列表：稳定，加载快，使用全局缓存
  // 用户列表：按需加载，支持实时更新
  const { models: agents, loading: agentsLoading } = useAgents();
  const { models: users, loading: usersLoading } = useUsers(currentUserId, refreshKey);
  
  // ✅ 优化：使用 useMemo 稳定合并结果，避免不必要的重新计算
  const chatModels = useMemo(() => {
    // 只有当数据真正变化时才重新合并
    return [...agents, ...users];
  }, [agents, users]);
  
  // ✅ 优化：只在真正加载时才显示加载状态
  const modelsLoading = agentsLoading || (usersLoading && refreshKey === 0); // 首次加载才显示加载状态

  // ✅ 优化：使用防抖来减少刷新频率，避免闪烁
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshKey((prev) => prev + 1);
    }, 300); // 300ms 防抖，避免频繁刷新
  }, []);

  // 用户状态管理（快速查询和SSE推送更新）
  const { fetchUserStatus, handleStatusUpdate, getCachedStatus } = useUserStatus({
    isLoggedIn,
    onStatusUpdate: useCallback((updates: Map<string, boolean>) => {
      // ✅ 优化：使用防抖刷新，避免频繁更新导致闪烁
      debouncedRefresh();
    }, [debouncedRefresh]),
  });

  // 分离 agents 和 users
  const availableAgents = useMemo(() => {
    return chatModels.filter((chatModel) => chatModel.type === "agent");
  }, [chatModels]);

  const availableUsers = useMemo(() => {
    if (!isLoggedIn) return [];
    const currentUserId = session?.user ? getBackendMemberId(session.user) : null;
    if (!currentUserId) return [];
    
    // ✅ 优化：统一使用chatModels（后端已只返回好友，确保与消息框下拉列表一致）
    // chatModels现在只包含当前用户的好友（通过user_id参数过滤）
    return chatModels.filter((chatModel) => {
      if (chatModel.type !== "user") return false;
      // 排除当前用户
      const chatModelMemberId = chatModel.id.replace(/^user::/, "");
      return chatModel.id !== `user::${currentUserId}` && 
             chatModelMemberId !== currentUserId;
    });
  }, [chatModels, isLoggedIn, session]);

  // ✅ 优化：预加载所有模型的头像信息，并更新用户在线状态（从缓存）
  // 使用稳定的依赖，避免频繁重新计算
  const modelsWithAvatars = useMemo(() => {
    const allModels = [...availableAgents, ...availableUsers];
    // ✅ 优化：只有当模型列表真正变化时才重新计算
    if (allModels.length === 0) return [];
    
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

  // ✅ 优化：组件挂载时刷新用户状态（只执行一次，避免重复刷新）
  const hasFetchedStatusRef = useRef(false);
  useEffect(() => {
    if (isLoggedIn && availableUsers.length > 0 && !hasFetchedStatusRef.current) {
      hasFetchedStatusRef.current = true;
      fetchUserStatus().then((statusMap) => {
        if (statusMap.size > 0) {
          handleStatusUpdate(statusMap);
        }
      });
    }
    // 重置标志，当用户列表变化时允许重新获取
    if (availableUsers.length === 0) {
      hasFetchedStatusRef.current = false;
    }
  }, [isLoggedIn, availableUsers.length, fetchUserStatus, handleStatusUpdate]);

  // ✅ 接受好友请求
  const handleAcceptRequest = useCallback(async (requestId: string) => {
    if (!currentUserId) return;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/friends/request/${requestId}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: currentUserId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "接受好友请求失败");
      }

      toast.success("已添加好友");
      // ✅ 刷新好友列表和模型列表（确保新好友立即显示）
      mutateFriends();
      // ✅ 优化：使用防抖刷新，避免频繁更新
      if (currentUserId) {
        globalMutate(`users_${currentUserId}`);
      }
      debouncedRefresh();
      // ✅ 触发好友更新事件，通知其他组件刷新
      window.dispatchEvent(new CustomEvent("sse_friend_update"));
    } catch (error) {
      console.error("接受好友请求失败:", error);
      toast.error(error instanceof Error ? error.message : "接受好友请求失败");
    }
  }, [currentUserId, mutateFriends]);

  // 监听好友更新事件（SSE推送）
  useEffect(() => {
    if (!isLoggedIn) return;

    const handleFriendUpdate = () => {
      // ✅ 优化：使用防抖刷新，避免频繁更新
      debouncedRefresh();
      mutateFriends();
    };

    const handleFriendRequestUpdate = () => {
      // 刷新好友请求列表（不需要刷新模型列表）
      mutateFriends();
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
        // ✅ 优化：不需要额外刷新，handleStatusUpdate 已经会触发防抖刷新
      }
    };

    window.addEventListener("sse_friend_update", handleFriendUpdate);
    window.addEventListener("sse_friend_request_update", handleFriendRequestUpdate);
    window.addEventListener("sse_user_status_update", handleUserStatusUpdate);

    return () => {
      window.removeEventListener("sse_friend_update", handleFriendUpdate);
      window.removeEventListener("sse_friend_request_update", handleFriendRequestUpdate);
      window.removeEventListener("sse_user_status_update", handleUserStatusUpdate);
      // ✅ 清理防抖定时器
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [isLoggedIn, handleStatusUpdate, mutateFriends, debouncedRefresh]);

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
              // ✅ 优化：使用防抖刷新，避免频繁更新
              debouncedRefresh();
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
                  
                  {/* ✅ 待处理的好友请求（显示在用户列表底部） */}
                  {pendingRequests.length > 0 && (
                    <>
                      {usersWithAvatars.length > 0 && <Separator className="my-3" />}
                      <div className="space-y-2">
                        {pendingRequests.map((request) => (
                          <div
                            key={request.id}
                            className={cn(
                              "flex items-center gap-3 px-2 py-2 rounded-lg",
                              "bg-sidebar-accent/50 border border-sidebar-border"
                            )}
                          >
                            <UnifiedAvatar
                              name={request.from_nickname}
                              id={`user::${request.from_user_id}`}
                              isAgent={false}
                              size={8}
                              showStatus={false}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {request.from_nickname}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                请求添加好友
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-3 text-xs"
                              onClick={() => handleAcceptRequest(request.id)}
                            >
                              同意
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            
            {/* ✅ 如果只有待处理的好友请求，没有用户好友 */}
            {usersWithAvatars.length === 0 && pendingRequests.length > 0 && (
              <>
                {agentsWithAvatars.length > 0 && <Separator className="my-3" />}
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                    用户
                  </div>
                  <div className="space-y-2">
                    {pendingRequests.map((request) => (
                      <div
                        key={request.id}
                        className={cn(
                          "flex items-center gap-3 px-2 py-2 rounded-lg",
                          "bg-sidebar-accent/50 border border-sidebar-border"
                        )}
                      >
                        <UnifiedAvatar
                          name={request.from_nickname}
                          id={`user::${request.from_user_id}`}
                          isAgent={false}
                          size={8}
                          showStatus={false}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {request.from_nickname}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            请求添加好友
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-3 text-xs"
                          onClick={() => handleAcceptRequest(request.id)}
                        >
                          同意
                        </Button>
                      </div>
                    ))}
                  </div>
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

