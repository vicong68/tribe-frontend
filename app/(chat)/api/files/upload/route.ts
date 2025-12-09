import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { getMinIOClient } from "@/lib/storage/minio-client";
import { getFileUploadConfig } from "@/lib/storage/config";

/**
 * 创建文件验证 Schema
 * 符合 Vercel AI Chatbot 最佳实践：配置化验证
 */
function createFileSchema() {
  const config = getFileUploadConfig();
  
  return z.object({
    file: z
      .instanceof(Blob)
      .refine(
        (file) => file.size <= config.maxFileSize,
        {
          message: `File size should be less than ${Math.round(config.maxFileSize / 1024 / 1024)}MB`,
        }
      )
      // 放宽文件类型限制：允许所有类型，由后端验证和处理
      // 前端仅做基本的大小验证，具体文件类型支持由后端决定
      // 注意：后端会根据Agent能力决定是否处理文件内容
      .refine(
        (file) => {
          // 如果配置中包含 application/octet-stream，则允许所有类型
          if (config.allowedMimeTypes.includes("application/octet-stream")) {
            return true;
          }
          // 如果文件类型为空或未知，也允许（由后端处理）
          if (!file.type || file.type === "application/octet-stream") {
            return true;
          }
          // 检查是否在允许列表中
          return config.allowedMimeTypes.length === 0 || 
                 config.allowedMimeTypes.includes(file.type);
        },
        {
          message: `File type not allowed. Allowed types: ${config.allowedMimeTypes.join(", ")}`,
        }
      ),
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return NextResponse.json({ error: "Request body is empty" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 使用配置化的验证 Schema
    const FileSchema = createFileSchema();
    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const filename = (formData.get("file") as File).name;
    const fileBuffer = await file.arrayBuffer();
    const contentType = file.type || "application/octet-stream";

    try {
      const minioClient = getMinIOClient();
      const userId = session.user?.id || session.user?.email || "anonymous";
      
      // 生成唯一的文件键
      const key = minioClient.generateKey(filename, userId);
      
      // 记录上传信息（用于调试和监控）
      console.log("[FileUpload] Uploading file:", {
        filename,
        size: file.size,
        contentType,
        userId,
        key,
      });
      
      // 上传到 MinIO
      const data = await minioClient.putObject(
        key,
        fileBuffer,
        contentType,
        true // 公开访问
      );

      console.log("[FileUpload] ✅ File uploaded successfully:", {
        url: data.url,
        pathname: data.pathname,
        size: data.size,
        fileId: data.fileId,
      });

      // 返回完整元数据，包含size和fileId
      return NextResponse.json({
        url: data.url,
        pathname: data.pathname,
        contentType: data.contentType,
        size: data.size,
        fileId: data.fileId,
      });
    } catch (error) {
      // 改进的错误处理和日志记录
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error("[FileUpload] ❌ MinIO upload error:", {
        error: errorMessage,
        stack: errorStack,
        filename,
        size: file.size,
        contentType,
      });
      
      return NextResponse.json(
        { 
          error: "Upload failed", 
          details: process.env.NODE_ENV === "development" ? errorMessage : "Internal server error" 
        },
        { status: 500 }
      );
    }
  } catch (error) {
    // 改进的错误处理和日志记录
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error("[FileUpload] ❌ Request processing error:", {
      error: errorMessage,
      stack: errorStack,
    });
    
    return NextResponse.json(
      { 
        error: "Failed to process request", 
        details: process.env.NODE_ENV === "development" ? errorMessage : "Internal server error" 
      },
      { status: 500 }
    );
  }
}
