import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  let redirectUrl = searchParams.get("redirectUrl") || "/"

  // Avoid redirect loops: if redirectUrl is auth-related, use home page
  if (redirectUrl.startsWith("/api/auth") || redirectUrl === "/login" || redirectUrl === "/register") {
    redirectUrl = "/"
  }

  // In the v0 preview environment, NextAuth cannot work properly because:
  // 1. No PostgreSQL database connection
  // 2. bcrypt-ts doesn't work in browser environment
  // 3. No backend API available
  // For production, this route would use signIn("guest") from auth.ts
  return NextResponse.redirect(new URL(redirectUrl, request.url))
}
