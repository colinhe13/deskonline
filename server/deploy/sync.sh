#!/bin/bash
# 部署脚本：将本地代码同步到远程服务器并重启服务
# 用法: ./deploy/sync.sh

set -e

SERVER="ubuntu@<YOUR_SERVER_IP>"
REMOTE_DIR="/home/ubuntu/texaspoker"

echo "==> 同步后端代码..."
rsync -avz --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude deploy \
  ./texaspoker-server/ ${SERVER}:${REMOTE_DIR}/server/

echo "==> 同步前端 build 产物..."
rsync -avz --delete \
  ./texaspoker-web/dist/ ${SERVER}:${REMOTE_DIR}/web/dist/

echo "==> 同步部署配置..."
rsync -avz \
  ./texaspoker-server/deploy/docker-compose.yml ${SERVER}:${REMOTE_DIR}/docker-compose.yml
rsync -avz \
  ./texaspoker-server/deploy/nginx/default.conf ${SERVER}:${REMOTE_DIR}/nginx/conf.d/default.conf

echo "==> 重建并重启服务..."
ssh ${SERVER} "cd ${REMOTE_DIR} && sudo docker compose up --build -d"

echo "==> 部署完成"
ssh ${SERVER} "cd ${REMOTE_DIR} && sudo docker compose ps"
