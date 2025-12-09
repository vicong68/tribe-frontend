import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * POST /api/v1/chat/upload - 文件上传代理到后端
 * 支持知识库上传和用户文件传输两种模式
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const isLoggedIn = session?.user?.type === "regular";
    const userId = isLoggedIn && session?.user ? getBackendMemberId(session.user) : "guest_user";
    const loginStatus = isLoggedIn ? "已登录" : "未登录";

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const transferMode = searchParams.get("transfer_mode") || "knowledge";

    // 获取 FormData
    const formData = await request.formData();

    // 确保 user_id 和 login_status 在 FormData 中
    formData.set("user_id", userId);
    formData.set("login_status", loginStatus);

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/chat/upload?transfer_mode=${transferMode}`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[File Upload API] 后端返回错误:", response.status, errorText);
      
      // 如果是 413 错误（文件太大），返回更友好的错误信息
      if (response.status === 413) {
        return NextResponse.json(
          { error: "文件大小超过限制（最大 100MB）" },
          { status: 413 }
        );
      }
      
      return NextResponse.json(
        { error: errorText || "上传失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[File Upload API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 500 }
    );
  }
}

