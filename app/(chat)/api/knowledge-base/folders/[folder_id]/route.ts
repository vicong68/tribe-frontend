import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * PATCH /api/knowledge-base/folders/[folder_id] - 更新文件夹（重命名）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ folder_id: string }> }
) {
  try {
    const { folder_id } = await params;
    const body = await request.json();
    const { folder_name, parent_id } = body;

    if (!folder_name) {
      return NextResponse.json(
        { error: "文件夹名称不能为空" },
        { status: 400 }
      );
    }

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/folders/${folder_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ folder_name, parent_id }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "更新文件夹失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Knowledge Base Folders API] Error:", error);
    return NextResponse.json(
      { error: "更新文件夹失败" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/knowledge-base/folders/[folder_id] - 删除文件夹
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ folder_id: string }> }
) {
  try {
    const { folder_id } = await params;

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/folders/${folder_id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "删除文件夹失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Knowledge Base Folders API] Error:", error);
    return NextResponse.json(
      { error: "删除文件夹失败" },
      { status: 500 }
    );
  }
}

