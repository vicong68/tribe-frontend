import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1), // 移除 max(2000) 限制，支持复杂格式的长消息
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  // 支持多种文件类型（不再限制为仅图片）
  mediaType: z.string().optional(), // MIME类型（可选，支持所有类型）
  name: z.string().min(1).max(200), // 文件名（增加长度限制）
  url: z.string().url(), // 文件URL
  // 扩展字段（可选）
  size: z.number().optional(), // 文件大小（字节）
  fileId: z.string().optional(), // 文件ID
  // ✅ 缩略图URL（可选，允许 null 或 undefined，仅图片文件）
  thumbnailUrl: z.string().url().nullable().optional(), // 允许 null 和 undefined
  // 支持嵌套file对象（向后兼容）
  file: z.object({
    file_id: z.string().optional(),
    filename: z.string().optional(),
    size: z.number().optional(),
    download_url: z.string().url().optional(),
    thumbnail_url: z.string().url().nullable().optional(), // ✅ 缩略图URL（嵌套格式，允许 null）
  }).optional(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  message: z.object({
    id: z.string().uuid(),
    role: z.enum(["user"]),
    parts: z.array(partSchema),
  }),
  selectedChatModel: z.string(), // Agent ID（标准化，如 "chat", "rag"）或 User ID（格式：user::member_id）
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
