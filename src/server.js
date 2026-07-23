/**
 * 人际关系网 PeopleNet 后端。
 *
 * 环境变量：
 *   MONGODB_URI        MongoDB 连接串（Atlas）
 *   JWT_SECRET         JWT 签名密钥
 *   DASHSCOPE_API_KEY  通义千问 API-KEY（语音解析代理；不再放客户端）
 *   QWEN_MODEL         默认 qwen-turbo
 *   MOCK_OTP           "true" = 原型演示模式（任意 6 位验证码可登录）。生产必须 false/不设
 *   ALLOWED_ORIGINS    允许跨域的浏览器来源，逗号分隔；不设 = 不发 CORS 头（原生 App 不受影响）
 *   PORT               Render 自动注入
 */
// 本地开发：可选加载项目根目录 .env（KEY=VALUE 每行，不覆盖已有环境变量）。
// 必须在 require 各路由之前执行——auth.js 等在模块加载时就读取 env。
// 生产（Render）用真实环境变量，没有 .env 文件时此段为空操作。
(() => {
  try {
    const fs = require('fs');
    const path = require('path');
    const envFile = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envFile)) return;
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    console.log('[env] loaded .env');
  } catch (e) { /* noop */ }
})();

const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const moneyRoutes = require('./routes/money');
const reminderRoutes = require('./routes/reminders');
const voiceRoutes = require('./routes/voice');
const { requireAuth } = require('./middleware/auth');
const { attachAsrRelay } = require('./asrRelay');

const app = express();
app.set('trust proxy', 1);   // Render 反代之后取真实客户端 IP（限流按 IP 计数）

// 原生 App 不走 CORS；只在显式配置 ALLOWED_ORIGINS 时对浏览器开放指定来源
const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'peoplenet-api',
    // Render 注入 RENDER_GIT_COMMIT，用于确认线上跑的是哪个提交
    commit: (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7),
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api/money', requireAuth, moneyRoutes);
app.use('/api/reminders', requireAuth, reminderRoutes);
app.use('/api/voice', requireAuth, voiceRoutes);

// 统一错误处理：5xx 只回泛化文案，细节留在服务端日志，不向客户端泄露内部信息
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error('[error]', req.method, req.path, err);
  res.status(status).json({ error: status < 500 ? (err.message || 'bad request') : 'server error' });
});

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  mongoose.connection.on('error', (e) => console.error('[mongo] error:', e.message));
  mongoose.connection.on('disconnected', () => console.warn('[mongo] disconnected, driver will retry'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('mongo connected');
  const port = process.env.PORT || 3000;
  const server = http.createServer(app);
  attachAsrRelay(server);   // wss://…/api/voice/asr 实时语音中继
  server.listen(port, () => console.log(`peoplenet-api listening on :${port}`));
}

// 供测试脚本 require 后自行启动
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { app, main };
