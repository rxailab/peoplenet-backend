/**
 * 人际关系网 PeopleNet 后端。
 *
 * 环境变量：
 *   MONGODB_URI        MongoDB 连接串（Atlas）
 *   JWT_SECRET         JWT 签名密钥
 *   DASHSCOPE_API_KEY  通义千问 API-KEY（语音解析代理；不再放客户端）
 *   QWEN_MODEL         默认 qwen-turbo
 *   MOCK_OTP           "true"（默认）= 原型模式，任意 6 位验证码可登录
 *   PORT               Render 自动注入
 */
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const moneyRoutes = require('./routes/money');
const reminderRoutes = require('./routes/reminders');
const voiceRoutes = require('./routes/voice');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'peoplenet-api',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api/money', requireAuth, moneyRoutes);
app.use('/api/reminders', requireAuth, reminderRoutes);
app.use('/api/voice', requireAuth, voiceRoutes);

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('mongo connected');
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`peoplenet-api listening on :${port}`));
}

// 供测试脚本 require 后自行启动
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { app };
