/**
 * 用户工具函数
 * 统一处理用户ID提取、状态更新等逻辑
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * 从 session user 中提取后端 memberId
 * 优先级：memberId > email前缀 > id
 */
export function getBackendMemberId(user: {
  memberId?: string | null;
  email?: string | null;
  id?: string;
}): string | null {
  if (user.memberId) {
    return user.memberId;
  }
  if (user.email) {
    return user.email.split("@")[0];
  }
  return user.id || null;
}

/**
 * 更新后端用户在线状态
 * @param memberId 用户ID
 * @param isOnline 是否在线
 */
export async function updateBackendOnlineStatus(
  memberId: string,
  isOnline: boolean
): Promise<void> {
  if (!memberId) {
    return;
  }

  try {
    const action = isOnline ? "login" : "logout";
    const response = await fetch(`${BACKEND_URL}/api/chat/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        member_id: memberId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update status: ${response.status}`);
    }
  } catch (error) {
    // 静默处理错误，不影响用户体验
    if (process.env.NODE_ENV === "development") {
      console.warn(`[UserStatus] Failed to update backend status:`, error);
    }
  }
}

/**
 * 使用 sendBeacon 更新后端用户离线状态（用于页面卸载时）
 * @param memberId 用户ID
 */
export function updateBackendOfflineStatusWithBeacon(memberId: string): void {
  if (!memberId || !navigator.sendBeacon) {
    return;
  }

  try {
    const formData = new FormData();
    formData.append("action", "logout");
    formData.append("member_id", memberId);

    navigator.sendBeacon(`${BACKEND_URL}/api/chat/register`, formData);
  } catch (error) {
    // 静默处理错误
    if (process.env.NODE_ENV === "development") {
      console.warn("[UserStatus] Failed to mark offline on page unload:", error);
    }
  }
}

