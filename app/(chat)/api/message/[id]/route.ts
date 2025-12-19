import { auth } from "@/app/(auth)/auth";
import { updateMessageMetadata, deleteMessageById } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";

/**
 * 更新消息的 metadata
 * 用于在收到后端返回的准确信息后更新消息元数据
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const { id } = await params;
    const body = await request.json();
    const { metadata } = body;

    if (!metadata || typeof metadata !== "object") {
      return new ChatSDKError("bad_request:api", "metadata is required").toResponse();
    }

    await updateMessageMetadata({
      messageId: id,
      metadata,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Failed to update message metadata:", error);
    return new ChatSDKError(
      "bad_request:api",
      error instanceof Error ? error.message : "Failed to update message metadata"
    ).toResponse();
  }
}

/**
 * 删除消息（硬删除）
 * 删除消息及其相关的投票记录
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const { id } = await params;

    // 硬删除消息（包括相关的投票记录）
    await deleteMessageById({ id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Failed to delete message:", error);
    return new ChatSDKError(
      "bad_request:api",
      error instanceof Error ? error.message : "Failed to delete message"
    ).toResponse();
  }
}
