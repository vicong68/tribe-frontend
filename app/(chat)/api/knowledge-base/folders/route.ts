import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

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

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/folders?${params.toString()}`,
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
      console.error("[Knowledge Base Folders API] 获取文件夹列表失败:", response.status);
      return NextResponse.json([], { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
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

