import "server-only";

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateMinIOConfig } from "./config";

/**
 * MinIO 客户端工具类
 * 使用 AWS S3 SDK（MinIO 兼容 S3 API）
 * 符合 Vercel AI Chatbot 最佳实践：配置验证和错误处理
 */
class MinIOClient {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    // 验证并获取配置（生产环境必须配置）
    let config;
    try {
      config = validateMinIOConfig();
    } catch (error) {
      // 开发环境允许使用默认值
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      console.warn("[MinIO] Using default configuration:", error instanceof Error ? error.message : String(error));
      config = {
        endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
        accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
        secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
        region: process.env.MINIO_REGION || "us-east-1",
        bucket: process.env.MINIO_BUCKET || "tribe-files",
        publicUrl: process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT || "http://localhost:9000",
      };
    }

    const { endpoint, accessKey, secretKey, region, bucket, publicUrl } = config;
    this.bucket = bucket;
    this.publicUrl = publicUrl;

    // 解析 endpoint URL
    const url = new URL(endpoint);
    const useSSL = url.protocol === "https:";

    this.client = new S3Client({
      endpoint: endpoint,
      region: region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // MinIO 需要路径样式
      ...(useSSL && {
        // 如果是 HTTPS，可能需要禁用 SSL 验证（自签名证书）
        // 生产环境建议使用有效证书
        // tls: { rejectUnauthorized: false }
      }),
    });
  }

  /**
   * 上传文件到 MinIO
   * @param key 文件键（路径）
   * @param buffer 文件内容（Buffer）
   * @param contentType 文件类型
   * @param isPublic 是否公开访问
   * @param originalFilename 原始文件名（用于标签存储）
   * @returns 文件 URL 和路径信息
   */
  async putObject(
    key: string,
    buffer: Buffer | ArrayBuffer,
    contentType: string,
    isPublic: boolean = true,
    originalFilename?: string
  ): Promise<{ url: string; pathname: string; contentType: string; size: number; fileId: string }> {
    const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const fileSize = bufferData.length;

    // ✅ AWS SDK 会自动为 Metadata key 添加 x-amz-meta- 前缀，不需要手动添加
    // ✅ HTTP header 值只能包含 ASCII 字符，需要对特殊字符（中文、括号等）进行编码
    // ✅ 只使用 Metadata 存储原始文件名（Tagging 有格式限制，可能不支持复杂字符）
    
    // 准备 Metadata（处理特殊字符）
    const metadata: Record<string, string> = {};
    
    if (originalFilename) {
      // ✅ Metadata 使用 Base64 编码（HTTP header 安全，完整支持所有字符包括中文、括号等）
      const base64Encoded = Buffer.from(originalFilename, "utf-8").toString("base64");
      metadata["original-filename"] = base64Encoded;
      metadata["original-filename-encoded"] = "base64";
    }
    
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bufferData,
      ContentType: contentType,
      ...(isPublic && {
        ACL: "public-read",
      }),
      // ✅ 只使用 Metadata 存储原始文件名（Base64 编码，完整支持特殊字符）
      // ✅ 移除 Tagging（TagValue 有格式限制，可能不支持 Base64 或其他编码的特殊字符）
      ...(Object.keys(metadata).length > 0 && { Metadata: metadata }),
    });

    await this.client.send(command);

    // 构建公开访问 URL
    const url = `${this.publicUrl}/${this.bucket}/${key}`;
    
    // 从key提取fileId（格式：users/{userId}/{timestamp}-{random}-{name}.{ext}）
    // fileId使用pathname作为唯一标识
    const fileId = key;

    return {
      url,
      pathname: key,
      contentType,
      size: fileSize,
      fileId,
    };
  }

  /**
   * 获取文件的预签名 URL（用于私有文件）
   * @param key 文件键
   * @param expiresIn 过期时间（秒），默认 1 小时
   * @returns 预签名 URL
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * 删除文件
   * @param key 文件键
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * 生成唯一的文件键
   * @param filename 原始文件名
   * @param userId 用户 ID（可选）
   * @returns 文件键
   */
  generateKey(filename: string, userId?: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const ext = filename.split(".").pop() || "";
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf(".")) || filename;
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9-_]/g, "_");

    if (userId) {
      return `users/${userId}/${timestamp}-${random}-${sanitizedName}.${ext}`;
    }

    return `uploads/${timestamp}-${random}-${sanitizedName}.${ext}`;
  }
}

// 单例实例
let minioClient: MinIOClient | null = null;

/**
 * 获取 MinIO 客户端实例（单例）
 */
export function getMinIOClient(): MinIOClient {
  if (!minioClient) {
    minioClient = new MinIOClient();
  }
  return minioClient;
}

