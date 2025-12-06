#!/usr/bin/env bash
set -e

FRONTEND_DIR="/home/vicong/my_projects/tribe-agents/tribe-frontend"

# 加载环境变量
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

echo "🚀 启动前端生产服务器..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查目录
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "❌ 前端目录不存在: $FRONTEND_DIR"
    exit 1
fi

cd "$FRONTEND_DIR"

# 检查并加载环境变量配置文件
ENV_PRODUCTION="$FRONTEND_DIR/.env.production"
if [ -f "$ENV_PRODUCTION" ]; then
    echo "✅ 检测到生产环境变量配置文件: .env.production"
    set -a
    source "$ENV_PRODUCTION" 2>/dev/null || true
    set +a
    echo "   - NEXTAUTH_URL: ${NEXTAUTH_URL:-未设置}"
    echo "   - NEXT_PUBLIC_BACKEND_URL: ${NEXT_PUBLIC_BACKEND_URL:-未设置}"
    echo "   - POSTGRES_URL: ${POSTGRES_URL:+已设置（已隐藏）}"
    echo ""
else
    echo "⚠️  未找到 .env.production 文件，将使用系统环境变量"
    echo ""
fi

# 检查依赖并安装
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@aws-sdk" ]; then
    echo "📦 安装/更新依赖..."
    pnpm install --prod=false
    echo ""
fi

# 检查是否已构建
if [ ! -d ".next" ]; then
    echo "🔨 未检测到构建文件，开始构建..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    pnpm build
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
fi

echo "📍 服务地址："
echo "  前端应用: http://localhost:8000"
echo "  后端 API: ${NEXT_PUBLIC_BACKEND_URL:-http://localhost:3000}/api"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 设置生产环境变量
export NODE_ENV=production

# 启动生产服务器（使用端口 8000）
pnpm exec next start -p 8000
