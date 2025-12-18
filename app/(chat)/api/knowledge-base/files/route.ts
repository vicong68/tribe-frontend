import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";
import { fetchWithErrorHandlers } from "@/lib/utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * GET /api/knowledge-base/files - 获取文件列表
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user ? getBackendMemberId(session.user) : null;

    // 构建查询参数
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    if (userId) {
      params.append("user_id", userId);
    }
    const folderId = searchParams.get("folder_id");
    if (folderId) {
      params.append("folder_id", folderId);
    }

    // 调用后端 API（优化：减少超时和重试次数）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时（减少等待时间）
    
    try {
      const response = await fetchWithErrorHandlers(
        `${BACKEND_URL}/api/knowledge-base/files?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
        {
          maxRetries: 1,  // 减少重试次数
          retryDelay: 500,  // 减少重试延迟
        }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json([]);
        }
        console.error("[Knowledge Base Files API] 获取文件列表失败:", response.status);
        return NextResponse.json([], { status: response.status });
      }

      const data = await response.json();
      return NextResponse.json(Array.isArray(data) ? data : []);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        console.error("[Knowledge Base Files API] 请求超时");
        return NextResponse.json([], { status: 504 });
      }
      console.error("[Knowledge Base Files API] Error:", error);
      return NextResponse.json([], { status: 500 });
    }
  } catch (error) {
    console.error("[Knowledge Base Files API] Error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

