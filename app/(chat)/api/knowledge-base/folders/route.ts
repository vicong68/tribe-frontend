import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";
import { fetchWithErrorHandlers } from "@/lib/utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * GET /api/knowledge-base/folders - 获取文件夹列表
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

    // ✅ 修复：添加缓存控制，确保获取最新数据
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
    
    try {
      const response = await fetchWithErrorHandlers(
        `${BACKEND_URL}/api/knowledge-base/folders?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            // ✅ 修复：添加缓存控制头，确保不使用缓存
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
          },
          signal: controller.signal,
          // ✅ 修复：Next.js fetch 缓存控制
          cache: "no-store",
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
        console.error("[Knowledge Base Folders API] 获取文件夹列表失败:", response.status);
        return NextResponse.json([], { status: response.status });
      }

      const data = await response.json();
      return NextResponse.json(Array.isArray(data) ? data : []);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        console.error("[Knowledge Base Folders API] 请求超时");
        return NextResponse.json([], { status: 504 });
      }
      console.error("[Knowledge Base Folders API] Error:", error);
      return NextResponse.json([], { status: 500 });
    }
  } catch (error) {
    console.error("[Knowledge Base Folders API] Error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

/**
 * POST /api/knowledge-base/folders - 创建文件夹
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user ? getBackendMemberId(session.user) : "guest_user";

    const body = await request.json();
    const { folder_name, parent_id } = body;

    if (!folder_name) {
      return NextResponse.json(
        { error: "文件夹名称不能为空" },
        { status: 400 }
      );
    }

    // 调用后端 API
    const response = await fetch(`${BACKEND_URL}/api/knowledge-base/folders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folder_name,
        user_id: userId,
        parent_id: parent_id ?? null,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "创建文件夹失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Knowledge Base Folders API] Error:", error);
    return NextResponse.json(
      { error: "创建文件夹失败" },
      { status: 500 }
    );
  }
}

