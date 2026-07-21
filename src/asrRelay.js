/**
 * 实时语音识别 WebSocket 中继：
 *   App ←(wss + JWT)→ 本服务 ←(wss + DASHSCOPE_API_KEY)→ DashScope Paraformer
 *
 * DashScope 协议对本服务透明：双向原样转发文本/二进制帧（run-task 控制消息、
 * PCM 音频、result-generated 事件都不解析），密钥只存在服务端。
 */
const { WebSocketServer, WebSocket } = require('ws');
const { verifyToken } = require('./middleware/auth');

const UPSTREAM = process.env.ASR_WS_ENDPOINT
  || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';

function attachAsrRelay(server) {
  const wss = new WebSocketServer({ server, path: '/api/voice/asr' });

  wss.on('connection', (client, req) => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) return client.close(1011, 'asr not configured');

    // JWT：Authorization: Bearer 头，或 ?token= 查询参数（部分 WS 客户端不便发头）
    const header = req.headers.authorization || '';
    const query = new URL(req.url, 'http://localhost').searchParams;
    const token = header.startsWith('Bearer ') ? header.slice(7) : query.get('token');
    if (!verifyToken(token)) return client.close(4401, 'unauthorized');

    const upstream = new WebSocket(UPSTREAM, {
      headers: {
        Authorization: `bearer ${key}`,
        'X-DashScope-DataInspection': 'enable',
      },
    });

    // 上游握手完成前先缓冲客户端消息（run-task 往往在连接后立即到达）
    const pending = [];
    upstream.on('open', () => {
      for (const [data, isBinary] of pending) upstream.send(data, { binary: isBinary });
      pending.length = 0;
    });

    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
    });
    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });

    const closeBoth = () => {
      try { client.close(); } catch (e) { /* noop */ }
      try { upstream.close(); } catch (e) { /* noop */ }
    };
    client.on('close', closeBoth);
    client.on('error', closeBoth);
    upstream.on('close', closeBoth);
    upstream.on('error', (e) => {
      console.error('[asr] upstream error:', e.message);
      closeBoth();
    });
  });

  return wss;
}

module.exports = { attachAsrRelay };
