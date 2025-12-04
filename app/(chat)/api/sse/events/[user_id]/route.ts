/**
 * SSE 事件流代理路由
 * 通过 Next.js API 路由代理到后端，避免跨域问题
 */
import { NextRequest } from "next/server";
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
    return new Response(
      JSON.stringify({ error: "未授权", code: 401 }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 获取查询参数
  const searchParams = request.nextUrl.searchParams;
  const heartbeatInterval = searchParams.get("heartbeat_interval") || "30";

  // 构建后端 SSE URL
  const backendUrl = `${BACKEND_API_URL}/api/sse/events/${user_id}?heartbeat_interval=${heartbeatInterval}`;

  try {
    // 代理请求到后端
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
      headers: {
        // 传递必要的 headers
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });

    if (!backendResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "后端服务错误",
          code: backendResponse.status,
        }),
        {
          status: backendResponse.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 返回流式响应
    return new Response(backendResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[SSE Proxy] 代理错误:", error);
    return new Response(
      JSON.stringify({
        error: "代理请求失败",
        code: 500,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

