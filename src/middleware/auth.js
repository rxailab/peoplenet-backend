const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// 生产环境必须显式配置 JWT_SECRET（render.yaml 已 generateValue）。
// 未配置时用进程内随机密钥兜底：服务能起、但重启后所有 token 失效，且启动时告警。
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[auth] JWT_SECRET 未设置，使用进程内随机密钥（重启即失效，仅限本地开发）');
  return crypto.randomBytes(32).toString('hex');
})();

function signToken(userId) {
  return jwt.sign({ uid: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
}

/** 校验 token，成功返回 uid，失败返回 null（供 HTTP 中间件与 WS 中继共用）。 */
function verifyToken(token) {
  try {
    return jwt.verify(token || '', JWT_SECRET).uid;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  const uid = verifyToken(token);
  if (!uid) return res.status(401).json({ error: 'invalid token' });
  req.userId = uid;
  next();
}

module.exports = { signToken, requireAuth, verifyToken };
