"use client";

import { useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { PlusIcon, TrashIcon } from "./icons";
import { useChatModels, clearModelsCache } from "@/lib/ai/models-client";
import { getBackendMemberId } from "@/lib/user-utils";
import { useUserStatus } from "@/hooks/use-user-status";
import { UnifiedAvatar } from "./unified-avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

interface SearchResult {
  id: string;
  name: string;
  type: "agent" | "user";
  description?: string;
  isOnline?: boolean;
}

/**
 * 好友管理组件（添加/删除好友）
 * 位于好友列表顶部
 */
export function FriendManager({ onRefresh }: { onRefresh?: () => void }) {
  const { data: session } = useSession();
  const isLoggedIn = session?.user?.type === "regular";
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  // 获取当前好友列表（用于判断是否已经是好友）
  const { models: currentFriends } = useChatModels(isLoggedIn, 0);

  // 用户状态管理（统一状态管理）
  const { getCachedStatus } = useUserStatus({
    isLoggedIn,
    onStatusUpdate: useCallback(() => {
      // 状态更新时不需要特殊处理，缓存会自动更新
    }, []),
  });

  // 搜索用户和智能体
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !isLoggedIn) return;

    setIsSearching(true);
    try {
      const currentUserId = getBackendMemberId(session?.user);
      // 搜索用户和智能体
      const searchUrl = new URL(`${BACKEND_URL}/api/search`);
      searchUrl.searchParams.set("q", searchQuery.trim());
      if (currentUserId) {
        searchUrl.searchParams.set("exclude_user_id", currentUserId);
      }
      
      const response = await fetch(searchUrl.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("搜索失败");
      }

      const data = await response.json();
      // 转换后端返回格式到前端格式
      const results: SearchResult[] = (data.results || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        description: item.description,
        isOnline: item.isOnline,
      }));
      setSearchResults(results);
    } catch (error) {
      console.error("搜索失败:", error);
      toast.error("搜索失败，请稍后重试");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, isLoggedIn]);

  // 检查是否已经是好友
  const isAlreadyFriend = useCallback(
    (id: string) => {
      return currentFriends.some((friend) => friend.id === id);
    },
    [currentFriends]
  );

  // 添加好友
  const handleAddFriend = useCallback(
    async (result: SearchResult) => {
      if (!isLoggedIn || isAdding) return;

      setIsAdding(true);
      try {
        const currentUserId = getBackendMemberId(session?.user);
        if (!currentUserId) {
          throw new Error("未登录");
        }

        if (result.type === "agent") {
          // 智能体直接添加（自动同意）
          const response = await fetch(`${BACKEND_URL}/api/friends/add`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: currentUserId,
              friendId: result.id,
              friendType: "agent",
            }),
          });

          if (!response.ok) {
            throw new Error("添加失败");
          }

          toast.success(`已添加智能体 ${result.name}`);
          clearModelsCache(true);
          onRefresh?.();
          setOpen(false);
          setSearchQuery("");
          setSearchResults([]);
        } else {
          // 用户需要发送好友申请
          const response = await fetch(`${BACKEND_URL}/api/friends/request`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from_user_id: currentUserId, // ✅ 修复：使用下划线命名，匹配后端API
              to_user_id: result.id, // ✅ 修复：使用下划线命名，匹配后端API
            }),
          });

          if (!response.ok) {
            // ✅ 优化：获取后端返回的错误信息
            const errorData = await response.json().catch(() => ({}));
            const errorDetail = errorData.detail || "发送好友申请失败";
            
            // ✅ 修复：如果是"已发送过"的错误，显示友好提示，不抛出错误
            if (errorDetail === "REQUEST_EXISTS" || errorDetail.includes("已发送过")) {
              toast.info("已发送过好友请求，待对方处理");
              setSearchQuery("");
              setSearchResults([]);
              return; // 直接返回，不抛出错误
            }
            
            throw new Error(errorDetail);
          }

          toast.success(`已向 ${result.name} 发送好友申请`);
          setSearchQuery("");
          setSearchResults([]);
        }
      } catch (error) {
        console.error("添加好友失败:", error);
        // ✅ 优化：显示具体的错误信息
        const errorMessage = error instanceof Error ? error.message : "操作失败，请稍后重试";
        toast.error(errorMessage);
      } finally {
        setIsAdding(false);
      }
    },
    [isLoggedIn, isAdding, session, onRefresh]
  );

  // 删除好友
  const handleRemoveFriend = useCallback(
    async (friendId: string, friendName: string) => {
      if (!isLoggedIn || isAdding) return;

      if (!confirm(`确定要删除好友 ${friendName} 吗？`)) {
        return;
      }

      setIsAdding(true);
      try {
        const currentUserId = getBackendMemberId(session?.user);
        if (!currentUserId) {
          throw new Error("未登录");
        }

        const response = await fetch(`${BACKEND_URL}/api/friends/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: currentUserId,
            friendId,
          }),
        });

        if (!response.ok) {
          throw new Error("删除失败");
        }

        toast.success(`已删除好友 ${friendName}`);
        clearModelsCache(true);
        onRefresh?.();
      } catch (error) {
        console.error("删除好友失败:", error);
        toast.error("删除失败，请稍后重试");
      } finally {
        setIsAdding(false);
      }
    },
    [isLoggedIn, isAdding, session, onRefresh]
  );

  // 过滤搜索结果：排除已经是好友的
  const filteredResults = useMemo(() => {
    return searchResults.filter((result) => !isAlreadyFriend(result.id));
  }, [searchResults, isAlreadyFriend]);

  if (!isLoggedIn) {
    return null;
  }

  return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="添加好友"
          >
            <PlusIcon size={16} />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加好友</DialogTitle>
            <DialogDescription>
              搜索用户或智能体的名称/ID，发送好友申请
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="搜索用户或智能体名称/ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                }}
              />
              <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
                {isSearching ? "搜索中..." : "搜索"}
              </Button>
            </div>

            {filteredResults.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {filteredResults.map((result) => {
                  // 判断是否是当前用户（本地用户不显示状态）
                  const isResultCurrentUser = (() => {
                    if (result.type !== "user" || !isLoggedIn || !session?.user) return false;
                    const currentUserId = getBackendMemberId(session.user);
                    if (!currentUserId) return false;
                    const resultMemberId = result.id.replace(/^user::/, "");
                    return resultMemberId === currentUserId;
                  })();
                  
                  // 统一状态管理：优先使用缓存状态，其次使用搜索结果中的状态
                  const cachedStatus = result.type === "user" ? getCachedStatus(result.id) : undefined;
                  const finalOnlineStatus = cachedStatus !== undefined ? cachedStatus : result.isOnline;
                  
                  return (
                  <div
                    key={result.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg",
                      "hover:bg-sidebar-accent cursor-pointer transition-colors"
                    )}
                  >
                    <UnifiedAvatar
                      name={result.name}
                      id={result.id}
                      isAgent={result.type === "agent"}
                      size={8}
                      showStatus={result.type === "user" && !isResultCurrentUser}
                      isOnline={finalOnlineStatus}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{result.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {result.type === "agent" ? "智能体" : "用户"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAddFriend(result)}
                      disabled={isAdding}
                    >
                      添加
                    </Button>
                  </div>
                  );
                })}
              </div>
            )}

            {searchQuery && !isSearching && filteredResults.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                未找到结果
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
  );
}

