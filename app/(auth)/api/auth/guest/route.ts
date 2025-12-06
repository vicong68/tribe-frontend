import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  let redirectUrl = searchParams.get("redirectUrl") || "/"

  // Avoid redirect loops: if redirectUrl is auth-related, use home page
  if (redirectUrl.startsWith("/api/auth") || redirectUrl === "/login" || redirectUrl === "/register") {
    redirectUrl = "/"
  }

  if (!process.env.POSTGRES_URL) {
    const cookieStore = await cookies()
    const mockSession = {
      user: {
        id: "preview-guest-user",
        email: "guest@preview.local",
        name: "Preview Guest",
      },
    }

    // Set a mock session cookie that the preview session provider can read
    cookieStore.set("preview-session", JSON.stringify(mockSession), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
  }

  return NextResponse.redirect(new URL(redirectUrl, request.url))
}
