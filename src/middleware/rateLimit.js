/**
 * 简易内存滑动窗口限流（单实例够用；多实例部署需换 Redis 等共享存储）。
 * 用法：router.post('/send-code', rateLimit({ windowMs: 10*60*1000, max: 10 }), handler)
 */
function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> 时间戳数组
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs);
  timer.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip || 'unknown';
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'too many requests', retryAfter: Math.ceil(windowMs / 1000) });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = { rateLimit };
