# Vercel Blob 到 MinIO 迁移总结

## 概述

本项目已完成从 Vercel Blob 到 MinIO（S3 兼容对象存储）的迁移，实现了完全自托管的文件存储方案。

## 更改内容

### 1. 依赖更新

**移除：**
- `@vercel/blob` (^0.24.1)

**新增：**
- `@aws-sdk/client-s3` (^3.700.0)
- `@aws-sdk/s3-request-presigner` (^3.700.0)

### 2. 新增文件

- `lib/storage/minio-client.ts` - MinIO 客户端工具类
  - 提供文件上传、下载、删除功能
  - 支持公开和私有文件访问
  - 支持预签名 URL（用于私有文件）
  - 自动生成唯一的文件键

- `MINIO_SETUP.md` - MinIO 配置和部署指南

### 3. 修改文件

#### `app/(chat)/api/files/upload/route.ts`
- 移除 `@vercel/blob` 的 `put` 函数
- 使用 `getMinIOClient()` 进行文件上传
- 保持相同的 API 响应格式（向后兼容）

#### `next.config.ts`
- 移除 Vercel Blob 的图片域名配置
- 添加 MinIO 图片域名配置（从环境变量读取）

#### `package.json`
- 更新依赖列表

#### `README.md`
- 更新存储方案说明

## 环境变量配置

需要在 `.env.local` 中添加以下配置：

```env
# MinIO Configuration (必需)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_REGION=us-east-1
MINIO_BUCKET=tribe-files
MINIO_PUBLIC_URL=http://localhost:9000

# File Upload Configuration (可选)
# 文件大小限制（MB），默认 5MB
MAX_FILE_SIZE_MB=5

# 允许的文件类型（逗号分隔的 MIME types），默认支持图片类型
# 示例：ALLOWED_FILE_TYPES=image/jpeg,image/png,image/gif,image/webp
ALLOWED_FILE_TYPES=image/jpeg,image/jpg,image/png,image/gif,image/webp

# 是否启用文件压缩（默认 false）
ENABLE_FILE_COMPRESSION=false

# 文件压缩质量（0-100，仅对图片有效，默认 80）
FILE_COMPRESSION_QUALITY=80
```

## API 兼容性

文件上传 API 保持向后兼容：

**请求：**
```typescript
POST /api/files/upload
Content-Type: multipart/form-data
Body: { file: File }
```

**响应：**
```typescript
{
  url: string;        // 文件访问 URL
  pathname: string;   // 文件路径（键）
  contentType: string; // 文件类型
}
```

## 文件存储结构

文件在 MinIO 中的存储结构：

```
tribe-files/
├── users/
│   └── {userId}/
│       └── {timestamp}-{random}-{filename}.{ext}
└── uploads/
    └── {timestamp}-{random}-{filename}.{ext}
```

## 功能特性

1. **公开文件访问**：支持设置文件为公开访问
2. **私有文件访问**：支持预签名 URL（1 小时有效期）
3. **文件删除**：支持删除已上传的文件
4. **唯一文件键**：自动生成唯一的文件键，避免冲突
5. **用户隔离**：支持按用户 ID 组织文件

## 部署步骤

1. **安装依赖**：
   ```bash
   pnpm install
   ```

2. **配置环境变量**：
   在 `.env.local` 中添加 MinIO 配置

3. **启动 MinIO 服务**：
   参考 `MINIO_SETUP.md` 中的说明

4. **创建存储桶**：
   在 MinIO 控制台中创建 `tribe-files` 存储桶（或使用 `MINIO_BUCKET` 配置的值）

5. **设置存储桶策略**：
   如果需要公开访问，设置存储桶策略为公开读取

6. **重启前端服务**：
   ```bash
   pnpm dev
   ```

## 测试验证

1. 启动 MinIO 服务
2. 配置环境变量
3. 重启前端服务
4. 尝试上传一个文件
5. 检查文件是否成功上传到 MinIO
6. 验证文件 URL 是否可以正常访问

## 故障排除

### 连接错误
- 检查 `MINIO_ENDPOINT` 是否正确
- 检查 MinIO 服务是否正在运行
- 检查网络连接

### 认证错误
- 检查 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 是否正确
- 确保在 MinIO 中创建了对应的用户

### 文件无法访问
- 检查存储桶策略是否允许公开读取
- 检查 `MINIO_PUBLIC_URL` 是否正确
- 检查 CORS 配置

## 已实现的优化

1. ✅ **配置化文件大小限制**：通过 `MAX_FILE_SIZE_MB` 环境变量可调整
2. ✅ **扩展文件类型支持**：通过 `ALLOWED_FILE_TYPES` 环境变量可配置支持的文件类型
3. ✅ **环境变量验证**：启动时验证 MinIO 配置，生产环境必须配置
4. ✅ **改进错误处理**：详细的错误日志和用户友好的错误消息
5. ✅ **配置管理模块**：统一的配置管理（`lib/storage/config.ts`）

## 后续优化建议

1. **文件压缩**：已预留接口，可通过 `ENABLE_FILE_COMPRESSION=true` 启用（需要实现压缩逻辑）
2. **CDN 集成**：可在 MinIO 前添加 CDN 加速
3. **文件清理**：可添加定期清理过期文件的机制
4. **文件元数据**：可保存更多文件元数据（上传时间、用户信息等）
5. **上传进度**：可添加上传进度跟踪功能

## 相关文档

- [MinIO 官方文档](https://min.io/docs)
- [AWS S3 SDK 文档](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)
- [MINIO_SETUP.md](./MINIO_SETUP.md) - MinIO 配置指南

