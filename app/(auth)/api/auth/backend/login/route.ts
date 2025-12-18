/**
 * 后端登录 API 路由
 * 作为 NextAuth 和后端之间的中间层，提供标准化的认证接口
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

const loginRequestSchema = z.object({
  email: z.string().email("无效的邮箱地址"),
  password: z.string().min(6, "密码至少需要6个字符"),
});

export async function POST(request: NextRequest) {
  try {
    // 验证请求来源（可选：可以添加额外的安全检查）
    const referer = request.headers.get("referer");
    const origin = request.headers.get("origin");
    
    // 仅允许来自同源的请求（服务器端调用）
    // 注意：NextAuth 的 authorize 函数在服务器端运行，所以这个检查是可选的
    
    const body = await request.json();
    
    // 验证请求数据
    const validatedData = loginRequestSchema.parse(body);

    // 调用后端登录 API
    const response = await fetch(`${BACKEND_API_URL}/api/chat/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "login",
        member_id: validatedData.email,
        password: validatedData.password,
      }),
    });

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { detail: "登录失败，请检查用户名和密码" };
      }

      // 解析后端统一错误格式
      const errorMessage =
        errorData.message ||
        (typeof errorData.detail === "string"
          ? errorData.detail
          : errorData.detail?.message || "登录失败，请检查用户名和密码");

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          code: errorData.code || "LOGIN_FAILED",
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!data.success || !data.member_data) {
      return NextResponse.json(
        {
          success: false,
          error: data.message || "登录失败",
          code: "LOGIN_FAILED",
        },
        { status: 401 }
      );
    }

    // 返回成功响应
    return NextResponse.json({
      success: true,
      user: {
        email: validatedData.email,  // 前端使用 email，但后端 member_id 就是 email 格式
        member_id: data.member_data.member_id,  // member_id 就是 email 格式
        nickname: data.member_data.nickname || validatedData.email.split("@")[0],
        user_group: data.member_data.user_group,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "请求数据验证失败",
          code: "VALIDATION_ERROR",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error("[Auth API] 登录错误:", error);
    return NextResponse.json(
      {
        success: false,
        error: "服务器内部错误",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

