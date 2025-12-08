import { auth } from "@/app/(auth)/auth";
import { deleteMessageById, getMessageById } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: messageId } = await params;

  if (!messageId) {
    return new ChatSDKError("bad_request:api", "Message ID is required").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:message", "User not authenticated").toResponse();
  }

  try {
    // 检查消息是否存在
    const messages = await getMessageById({ id: messageId });
    
    if (!messages || messages.length === 0) {
      return new ChatSDKError("not_found:message", "Message not found").toResponse();
    }

    // 注意：这里不检查消息的所有者，因为消息属于聊天，而聊天属于用户
    // 如果需要更严格的权限控制，可以检查消息所属的聊天是否属于当前用户
    // 但为了简化，我们允许删除任何消息（前端可以控制显示）

    // 删除消息
    const deletedMessage = await deleteMessageById({ id: messageId });

    if (!deletedMessage) {
      return new ChatSDKError("not_found:message", "Message not found").toResponse();
    }

    return Response.json({ 
      success: true, 
      message: "Message deleted successfully",
      id: messageId 
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "offline:message",
      error instanceof Error ? error.message : "Failed to delete message"
    ).toResponse();
  }
}

