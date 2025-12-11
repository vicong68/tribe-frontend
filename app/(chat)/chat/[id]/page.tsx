import { cookies } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/app/(auth)/auth";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { convertToUIMessages } from "@/lib/utils";

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <ChatPage params={props.params} />
    </Suspense>
  );
}

async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  // 标记为动态渲染，避免预渲染时 headers() 错误
  noStore();
  
  const { id } = await params;
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  const session = await auth();

  if (!session) {
    redirect("/api/auth/guest");
  }

  if (chat.visibility === "private") {
    if (!session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messagesFromDb = await getMessagesByChatId({
    id,
  });

  const uiMessages = convertToUIMessages(messagesFromDb);

  // ✅ 优先从消息 metadata 中获取 agent ID（后端保存时已保存 agentUsed）
  // 这样刷新页面时能正确显示 agent 名称（如 "司仪"）而不是 ID（如 "chat"）
  let agentModelId: string | undefined;
  const firstAssistantMessage = uiMessages.find((msg) => msg.role === "assistant");
  if (firstAssistantMessage?.metadata?.agentUsed) {
    agentModelId = firstAssistantMessage.metadata.agentUsed as string;
  }

  // 回退到 cookie（如果消息中没有 metadata）
  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get("chat-model");
  const finalChatModel = agentModelId || chatModelFromCookie?.value || DEFAULT_CHAT_MODEL;

  // ✅ 注意：Server Component 中不能直接修改 cookie
  // agent ID 已通过 initialChatModel 传递给 Chat 组件，ModelSelector 会在用户交互时更新 cookie
  // 这里只需要确保 initialChatModel 使用正确的值即可

  return (
    <>
      <Chat
        autoResume={true}
        id={chat.id}
        initialChatModel={finalChatModel}
        initialLastContext={chat.lastContext ?? undefined}
        initialMessages={uiMessages}
        initialVisibilityType={chat.visibility}
        isReadonly={session?.user?.id !== chat.userId}
      />
      <DataStreamHandler />
    </>
  );
}
