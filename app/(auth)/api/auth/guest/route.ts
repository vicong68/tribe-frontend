import { NextResponse } from "next/server"
import { isDevelopmentEnvironment } from "@/lib/constants"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  let redirectUrl = searchParams.get("redirectUrl") || "/"

  // 避免重定向循环：如果 redirectUrl 是认证相关路径，使用首页
  if (redirectUrl.startsWith("/api/auth") || redirectUrl === "/login" || redirectUrl === "/register") {
    redirectUrl = "/"
  }

  // In v0 preview, we can't use full NextAuth functionality
  // Just redirect to the home page or requested URL
  try {
    // Try to use the full auth flow
    const { getToken } = await import("next-auth/jwt")
    const { signIn } = await import("@/app/(auth)/auth")

    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    })

    if (token) {
      return NextResponse.redirect(new URL(redirectUrl, request.url))
    }

    return signIn("guest", { redirect: true, redirectTo: redirectUrl })
  } catch (error) {
    // Fallback for v0 preview - just redirect
    console.warn("[guest route] Auth not available, redirecting directly:", error)
    return NextResponse.redirect(new URL(redirectUrl, request.url))
  }
}
