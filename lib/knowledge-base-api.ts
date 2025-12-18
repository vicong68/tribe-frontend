/**
 * 知识库 API 统一封装
 * 最佳实践：前端只负责调用，所有逻辑判断和数据处理由后端完成
 */

const API_BASE = "/api/knowledge-base";

/**
 * 统一的 API 响应类型
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 统一的错误处理
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.detail || `请求失败: ${response.status}`);
  }
  return response.json();
}

/**
 * 文件夹操作 API
 */
export const folderApi = {
  /**
   * 获取文件夹列表
   * 后端自动处理 user_id 过滤和递归文件计数
   */
  async list(): Promise<any[]> {
    const response = await fetch(`${API_BASE}/folders`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    return handleResponse(response);
  },

  /**
   * 创建文件夹
   * 后端自动处理验证、层级检查等
   */
  async create(folderName: string, parentId?: string | null): Promise<any> {
    const response = await fetch(`${API_BASE}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_name: folderName, parent_id: parentId ?? null }),
    });
    return handleResponse(response);
  },

  /**
   * 更新文件夹（重命名）
   * 后端自动处理验证
   */
  async update(folderId: string, folderName: string): Promise<any> {
    const response = await fetch(`${API_BASE}/folders/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_name: folderName }),
    });
    return handleResponse(response);
  },

  /**
   * 删除文件夹
   * 后端自动处理软删除、子文件夹处理等
   */
  async delete(folderId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/folders/${folderId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.detail || "删除失败");
    }
  },

  /**
   * 移动文件夹
   * 后端自动处理层级验证、循环检测等
   */
  async move(folderId: string, targetParentId: string | null): Promise<any> {
    const response = await fetch(`${API_BASE}/folders/${folderId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_id: targetParentId }),
    });
    return handleResponse(response);
  },
};

/**
 * 文件操作 API
 */
export const fileApi = {
  /**
   * 获取文件列表
   * 后端自动处理 user_id 过滤、文件夹过滤等
   */
  async list(folderId?: string | null): Promise<any[]> {
    const params = new URLSearchParams();
    if (folderId) params.append("folder_id", folderId);
    const response = await fetch(`${API_BASE}/files?${params.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    return handleResponse(response);
  },

  /**
   * 更新文件（移动、重命名）
   * 后端自动处理验证
   */
  async update(fileId: string, updates: { filename?: string; folder_id?: string | null }): Promise<any> {
    const response = await fetch(`${API_BASE}/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return handleResponse(response);
  },

  /**
   * 删除文件
   * 后端自动处理软删除
   */
  async delete(fileId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/files/${fileId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.detail || "删除失败");
    }
  },
};

