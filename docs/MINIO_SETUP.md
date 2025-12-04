# MinIO 配置指南

本项目已从 Vercel Blob 迁移到 MinIO（S3 兼容的对象存储服务）。

## 环境变量配置

在 `.env.local` 文件中添加以下 MinIO 配置：

```env
# MinIO Configuration (S3-compatible object storage)
# MinIO 服务端点（本地或远程）
MINIO_ENDPOINT=http://localhost:9000
# MinIO 访问密钥
MINIO_ACCESS_KEY=minioadmin
# MinIO 密钥
MINIO_SECRET_KEY=minioadmin
# MinIO 区域（可选，默认 us-east-1）
MINIO_REGION=us-east-1
# MinIO 存储桶名称
MINIO_BUCKET=tribe-files
# MinIO 公开访问 URL（用于生成文件访问链接）
# 如果使用 Nginx 反向代理，设置为代理后的 URL
MINIO_PUBLIC_URL=http://localhost:9000
```

## 安装和启动 MinIO

### 使用 Docker（推荐）

```bash
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  -v /path/to/data:/data \
  minio/minio server /data --console-address ":9001"
```

### 使用二进制文件

1. 下载 MinIO：https://min.io/download
2. 启动 MinIO：
```bash
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin
minio server /path/to/data --console-address ":9001"
```

## 创建存储桶

1. 访问 MinIO 控制台：http://localhost:9001
2. 使用 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 登录
3. 创建存储桶（Bucket），名称与 `MINIO_BUCKET` 环境变量一致（默认：`tribe-files`）
4. 设置存储桶策略为公开读取（如果需要公开访问文件）：
   - 进入存储桶设置
   - 选择 "Access Policy"
   - 设置为 "Public" 或使用以下 JSON 策略：
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {"AWS": ["*"]},
         "Action": ["s3:GetObject"],
         "Resource": ["arn:aws:s3:::tribe-files/*"]
       }
     ]
   }
   ```

## 生产环境配置

### 使用 Nginx 反向代理

如果使用 Nginx 作为反向代理，配置示例：

```nginx
server {
    listen 80;
    server_name files.yourdomain.com;

    location / {
        proxy_pass http://localhost:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

然后设置 `MINIO_PUBLIC_URL=http://files.yourdomain.com`

### 使用 HTTPS

1. 配置 SSL 证书（Let's Encrypt 或其他）
2. 更新 `MINIO_ENDPOINT` 和 `MINIO_PUBLIC_URL` 为 HTTPS URL
3. 确保 MinIO 配置了有效的 SSL 证书

## 验证配置

1. 确保 MinIO 服务正在运行
2. 确保存储桶已创建
3. 重启前端服务
4. 尝试上传一个文件，检查是否成功

## 故障排除

### 连接错误

- 检查 `MINIO_ENDPOINT` 是否正确
- 检查 MinIO 服务是否正在运行
- 检查防火墙设置

### 认证错误

- 检查 `MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 是否正确
- 确保在 MinIO 控制台中创建了对应的用户

### 文件无法访问

- 检查存储桶策略是否允许公开读取
- 检查 `MINIO_PUBLIC_URL` 是否正确
- 检查 CORS 配置（如果需要跨域访问）

## 迁移说明

从 Vercel Blob 迁移到 MinIO 后：

- ✅ 文件上传功能已更新为使用 MinIO
- ✅ 文件访问 URL 格式已更新
- ✅ 不再依赖 `@vercel/blob` 包
- ✅ 使用 `@aws-sdk/client-s3` 作为 S3 兼容客户端

## 相关文件

- `lib/storage/minio-client.ts` - MinIO 客户端工具类
- `app/(chat)/api/files/upload/route.ts` - 文件上传路由
- `next.config.ts` - Next.js 配置（图片域名）

