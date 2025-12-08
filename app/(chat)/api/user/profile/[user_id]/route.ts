/**
 * 用户资料 API 路由
 * 代理到后端
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const { user_id } = await params;
  const session = await auth();

  // 验证用户身份
  if (!session?.user) {
    return NextResponse.json(
      { error: "未授权", code: 401 },
      { status: 401 }
    );
  }

  try {
    // 代理请求到后端
    const backendUrl = `${BACKEND_API_URL}/api/user/profile/${user_id}`;
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "无法读取错误响应");
      return NextResponse.json(
        {
          error: "后端服务错误",
          code: backendResponse.status,
          message: errorText || backendResponse.statusText,
        },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[User Profile API] 代理错误:", errorMessage);
    
    return NextResponse.json(
      {
        error: "代理请求失败",
        code: 500,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

