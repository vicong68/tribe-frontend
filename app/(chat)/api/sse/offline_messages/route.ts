/**
 * 离线消息拉取代理路由
 * 通过 Next.js API 路由代理到后端，避免跨域问题
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackendMemberId } from "@/lib/user-utils";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // 验证用户身份
    if (!session?.user || session.user.type !== "regular") {
      return NextResponse.json(
        { error: "请先登录", code: 401 },
        { status: 401 }
      );
    }

    const userId = getBackendMemberId(session.user);
    if (!userId) {
      return NextResponse.json(
        { error: "无法获取用户ID", code: 400 },
        { status: 400 }
      );
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const timeout = searchParams.get("timeout") || "5";
    const waitInterval = searchParams.get("wait_interval") || "1";
    const requestUserId = searchParams.get("user_id");

    // 验证 user_id 参数
    if (!requestUserId || requestUserId !== userId) {
      return NextResponse.json(
        { error: "用户ID不匹配", code: 403 },
        { status: 403 }
      );
    }

    // 构建后端 API URL
    const backendUrl = `${BACKEND_API_URL}/api/chat/offline_messages?user_id=${encodeURIComponent(userId)}&timeout=${timeout}&wait_interval=${waitInterval}`;

    try {
      // 代理请求到后端
      const backendResponse = await fetch(backendUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout((parseInt(timeout) + 5) * 1000), // 后端超时 + 5秒缓冲
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
      console.error("[OfflineMessages Proxy] 代理错误:", errorMessage);
      
      // 如果是超时错误，返回空列表而不是错误
      if (errorMessage.includes("timeout") || errorMessage.includes("aborted")) {
        return NextResponse.json({ offline_messages: [] });
      }
      
      return NextResponse.json(
        {
          error: "代理请求失败",
          code: 500,
          message: errorMessage,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[OfflineMessages Proxy] 路由错误:", errorMessage);
    
    return NextResponse.json(
      {
        error: "服务器内部错误",
        code: 500,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

