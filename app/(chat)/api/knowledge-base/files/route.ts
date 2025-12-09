import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

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

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/files?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

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
    console.error("[Knowledge Base Files API] Error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

