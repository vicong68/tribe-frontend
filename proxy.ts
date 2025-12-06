import { type NextRequest, NextResponse } from "next/server"
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants"

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 })
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  let token = null
  try {
    const { getToken } = await import("next-auth/jwt")
    token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    })
  } catch (e) {
    // In v0 preview, getToken may fail - allow request to proceed
    console.warn("[proxy] Failed to get token:", e)
  }

  if (!token) {
    // 避免重定向循环：如果当前路径已经是认证相关路径，直接重定向到首页
    if (pathname.startsWith("/api/auth") || pathname === "/login" || pathname === "/register") {
      return NextResponse.redirect(new URL("/api/auth/guest", request.url))
    }

    // 构建重定向 URL，使用 pathname 而不是完整 URL，避免循环
    const redirectUrl = encodeURIComponent(pathname)

    return NextResponse.redirect(new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url))
  }

  const isGuest = guestRegex.test(token?.email ?? "")

  if (token && !isGuest && ["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
}
