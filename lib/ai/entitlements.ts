import type { UserType } from "@/app/(auth)/auth";
import type { ChatModel } from "./models";

type Entitlements = {
  maxMessagesPerDay: number;
  availableChatModelIds: ChatModel["id"][];
};

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: 20,
    availableChatModelIds: ["chat"], // 标准化：使用 agent_id（对应"司仪"）
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: ["chat", "rag"], // 标准化：使用 agent_id（对应"司仪"和"书吏"）
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
