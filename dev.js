/**
 * 本地开发启动器（模拟机联调用）：
 *   npm run dev
 *
 * - 自动起一个内存 MongoDB（不用装 Mongo，进程退出即清空）
 * - 加载 .env（阿里云短信 key、DASHSCOPE_API_KEY 等）
 * - 监听 0.0.0.0:3000 —— Android 模拟器里用 http://10.0.2.2:3000 访问
 *   （App 端把 ApiClient.USE_LOCAL_BACKEND 置为 true）
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mem = await MongoMemoryServer.create();
  if (!process.env.MONGODB_URI) process.env.MONGODB_URI = mem.getUri('peoplenet');
  if (!process.env.PORT) process.env.PORT = '3000';

  const { main } = require('./src/server');
  await main();
  console.log('');
  console.log('本地联调后端已就绪：');
  console.log('  健康检查   http://127.0.0.1:3000/api/health');
  console.log('  模拟器访问 http://10.0.2.2:3000');
  console.log('  短信通道   ' + (process.env.ALIYUN_SMS_KEY_ID && process.env.ALIYUN_SMS_KEY_SECRET
    ? '阿里云（真实下发）' : '未配置 → 验证码走 devCode 回传'));
})().catch((e) => { console.error(e); process.exit(1); });
