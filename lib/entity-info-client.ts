/**
 * 实体信息客户端
 * 统一管理 Agent 和 User 的信息查询
 * 区分简要信息（用于列表）和完整信息（用于详情）
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * Agent 简要信息（用于列表显示）
 */
export interface AgentSummary {
  id: string; // Agent ID（如 "chat", "rag"）
  display_name: string; // 主显示名称
  display_names: string[]; // 所有显示名称
  description: string;
  type: "agent";
  status: "online" | "offline" | "busy";
}

/**
 * User 简要信息（用于列表显示）
 */
export interface UserSummary {
  id: string; // user::member_id
  display_name: string; // 显示名称（昵称）
  type: "user";
  is_online: boolean;
  last_seen_at?: string;
}

/**
 * Agent 完整信息（用于详情查询）
 */
export interface AgentDetail {
  id: string;
  display_names: string[];
  primary_display_name: string;
  description: string;
  category?: string;
  model?: {
    provider?: string;
    id?: string;
  };
  tools: Array<{
    type: string;
    options?: Record<string, any>;
  }>;
  knowledge?: string;
  status: "online" | "offline" | "busy";
  is_registered: boolean;
  last_updated: string;
}

/**
 * User 完整信息（用于详情查询）
 */
export interface UserDetail {
  member_id: string;
  display_name: string;
  email?: string;
  is_online: boolean;
  last_seen_at?: string;
  last_login_at?: string;
  user_group?: string;
  introduction?: string;
  created_at?: string;
  frontend_user_id?: string;
  last_updated: string;
}

/**
 * 实体简要信息响应
 */
export interface EntitiesSummaryResponse {
  success: boolean;
  agents?: AgentSummary[];
  users?: UserSummary[];
}

/**
 * Agent 详情响应
 */
export interface AgentDetailResponse {
  success: boolean;
  agent: AgentDetail;
}

/**
 * User 详情响应
 */
export interface UserDetailResponse {
  success: boolean;
  user: UserDetail;
}

/**
 * 获取实体简要信息列表
 * @param entityType 实体类型：'agent' | 'user' | undefined（全部）
 * @param refresh 是否强制刷新缓存
 */
export async function fetchEntitiesSummary(
  entityType?: "agent" | "user",
  refresh: boolean = false
): Promise<EntitiesSummaryResponse> {
  const params = new URLSearchParams();
  if (entityType) {
    params.append("entity_type", entityType);
  }
  if (refresh) {
    params.append("refresh", "true");
  }

  const response = await fetch(
    `${BACKEND_URL}/api/entity/summary?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch entities summary: ${response.status}`);
  }

  return response.json();
}

/**
 * 获取 Agent 完整信息
 * @param agentId Agent ID 或显示名称
 * @param refresh 是否强制刷新缓存
 */
export async function fetchAgentDetail(
  agentId: string,
  refresh: boolean = false
): Promise<AgentDetailResponse> {
  const params = new URLSearchParams();
  if (refresh) {
    params.append("refresh", "true");
  }

  const response = await fetch(
    `${BACKEND_URL}/api/entity/agent/${encodeURIComponent(agentId)}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Agent '${agentId}' not found`);
    }
    throw new Error(`Failed to fetch agent detail: ${response.status}`);
  }

  return response.json();
}

/**
 * 获取 User 完整信息
 * @param memberId member_id、display_name 或 frontend_user_id
 * @param refresh 是否强制刷新缓存
 */
export async function fetchUserDetail(
  memberId: string,
  refresh: boolean = false
): Promise<UserDetailResponse> {
  const params = new URLSearchParams();
  if (refresh) {
    params.append("refresh", "true");
  }

  const response = await fetch(
    `${BACKEND_URL}/api/entity/user/${encodeURIComponent(memberId)}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`User '${memberId}' not found`);
    }
    throw new Error(`Failed to fetch user detail: ${response.status}`);
  }

  return response.json();
}

/**
 * 刷新实体信息缓存
 */
export async function refreshEntitiesCache(): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${BACKEND_URL}/api/entity/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh entities cache: ${response.status}`);
  }

  return response.json();
}

