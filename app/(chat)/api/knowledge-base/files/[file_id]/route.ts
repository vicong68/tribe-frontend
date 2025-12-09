import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * PATCH /api/knowledge-base/files/[file_id] - 更新文件信息（重命名、移动文件夹）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ file_id: string }> }
) {
  try {
    const { file_id } = await params;
    const body = await request.json();
    const { filename, folder_id } = body;

    if (!filename && folder_id === undefined) {
      return NextResponse.json(
        { error: "至少需要提供一个更新字段" },
        { status: 400 }
      );
    }

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/files/${file_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename,
          folder_id,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "更新文件失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Knowledge Base Files API] Error:", error);
    return NextResponse.json(
      { error: "更新文件失败" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/knowledge-base/files/[file_id] - 删除文件
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ file_id: string }> }
) {
  try {
    const { file_id } = await params;

    // 调用后端 API
    const response = await fetch(
      `${BACKEND_URL}/api/knowledge-base/files/${file_id}`,
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
        { error: errorData.detail || "删除文件失败" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Knowledge Base Files API] Error:", error);
    return NextResponse.json(
      { error: "删除文件失败" },
      { status: 500 }
    );
  }
}

