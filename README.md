# DeskOnline — 朋友间的德州扑克在线平台

一个面向小圈子的德州扑克 Web 游戏平台：纯积分娱乐，不涉及任何真钱交易。支持桌面与移动端浏览器，内置 LLM 驱动的 AI 玩家，缺少牌友时也能随时开局。

## 特性

- **服务端权威牌局引擎**：发牌、牌型评估、边池计算、结算全部在服务端完成，客户端仅做展示
- **积分系统**：带入/带出以数据库事务保障，附每日积分增减排行与实时榜单推送
- **房间体验**：入座/观战、中途加入、断线自动托管、摊牌双方牌型对比、结算横幅
- **同桌语音**：基于 LiveKit 的同桌语音通话（不做全局大厅语音）
- **AI 玩家**：接入 OpenAI 兼容协议 LLM（默认 DeepSeek）驱动决策，具备人格设定、对手画像、经验笔记与全局反思等自学习能力；可在入桌前选择 AI 账号

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript + Vite + Pinia + livekit-client |
| 后端 | Node.js + Express + ws（WebSocket）+ zod |
| 数据 | PostgreSQL + Prisma（账号、积分、AI 学习数据持久化；牌局运行时状态在内存） |
| 认证 | JWT + bcrypt |
| 语音 | LiveKit（自托管 livekit-server） |
| AI | OpenAI 兼容协议 LLM 客户端（默认 DeepSeek） |

## 目录结构

```
server/   游戏服务器（feature-first 结构）
  src/poker/        牌局引擎（evaluator 牌型评估、engine 流程、betting 下注、settle 结算）
  src/lobby/        房间与座位管理
  src/ws/           WebSocket 网关与协议
  src/ai/           AI 玩家（决策、画像、反思、经验笔记）
  src/auth|points|leaderboard|voice/
  prisma/           数据模型与迁移
  deploy/           Docker Compose、Nginx、LiveKit 配置与部署脚本
web/      前端（feature-first 结构：views / components / stores / composables）
```

## 快速开始

### 服务端

```bash
cd server
cp .env.example .env        # 填入数据库、JWT、LiveKit、LLM 配置
npm install
npx prisma migrate deploy
npm run dev                 # 或 npm run build && npm start
```

### 前端

```bash
cd web
cp .env.development .env.development.local   # 按需修改 API 地址
npm install
npm run dev
```

`.env.development` 中的 `VITE_API_BASE` / `VITE_WS_BASE` 指向你的游戏服务器地址。

### 部署

`server/deploy/` 提供 Docker Compose 编排（game-server + nginx + livekit-server）：

```bash
# 在仓库根目录执行，TP_SERVER_IP 指向你的服务器地址
TP_SERVER_IP=<your-ip> ./server/deploy/sync.sh
```

服务器上需准备 `.env`（参考 `server/.env.example`）供 compose 注入。

## 开发

```bash
# 服务端
npm run test          # vitest
npm run lint          # eslint
npm run format:check  # prettier

# 前端
npm run test          # vitest
```

牌局引擎（牌型评估、边池、结算）与积分变更均有单元测试覆盖；任何客户端输入都经服务端校验，未摊牌的玩家手牌不会下发。

## 许可

[MIT](./LICENSE)

## 声明

本项目仅供朋友间娱乐，积分为虚拟数值，不提供、不支持任何形式的真钱交易与兑现。
