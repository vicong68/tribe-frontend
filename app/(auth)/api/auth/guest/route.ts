import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let redirectUrl = searchParams.get("redirectUrl") || "/";

  // 避免重定向循环：如果 redirectUrl 是认证相关路径，使用首页
  if (redirectUrl.startsWith("/api/auth") || redirectUrl === "/login" || redirectUrl === "/register") {
    redirectUrl = "/";
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
}
