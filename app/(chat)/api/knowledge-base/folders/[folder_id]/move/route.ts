import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * PATCH /api/knowledge-base/folders/[folder_id]/move - 移动文件夹
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ folder_id: string }> }
) {
  try {
    const { folder_id } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { parent_id } = body;

    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/folders/${folder_id}/move`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent_id }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "移动失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "移动失败" },
      { status: 500 }
    );
  }
}

