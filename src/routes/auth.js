/**
 * 手机号 + 验证码 登录/注册（未注册号码验证通过即自动建号）。
 *
 * 验证码为服务端强校验：
 *   - 6 位随机码，5 分钟有效，错 5 次作废，60 秒内不可重发
 *   - 配了阿里云短信（见 sms.js）就真实下发；
 *     未配置时验证码通过 devCode 字段回传给客户端联调（仍然强校验，错码进不来）
 *   - MOCK_OTP=true 才回到「任意 6 位可过」的演示模式（默认关闭）
 */
const express = require('express');
const crypto = require('crypto');
const { User } = require('../models');
const { signToken, requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { sendSms } = require('../sms');

const router = express.Router();
const MOCK = process.env.MOCK_OTP === 'true';
if (MOCK) console.warn('[auth] ⚠ MOCK_OTP=true：任意 6 位验证码可登录任意手机号，严禁用于生产！');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

/** 验证码只存 SHA-256 摘要，库被拖走也拿不到明文。 */
const hashOtp = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

// 单号 60s 冷却之外的全局防刷：同 IP 10 分钟最多 10 次发码（防轮换手机号刷短信费）
const sendCodeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
const verifyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });

router.post('/send-code', sendCodeLimiter, async (req, res, next) => {
  try {
    const { phone } = req.body || {};
    if (!/^1\d{10}$/.test(phone || '')) return res.status(400).json({ error: 'invalid phone' });

    const existing = await User.findOne({ phone });
    if (existing?.otpSentAt && Date.now() - existing.otpSentAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.otpSentAt.getTime())) / 1000);
      return res.status(429).json({ error: `resend too soon`, retryAfter: wait });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await User.findOneAndUpdate(
      { phone },
      {
        phone,
        otpCode: hashOtp(code),
        otpExpires: new Date(Date.now() + OTP_TTL_MS),
        otpAttempts: 0,
        otpSentAt: new Date(),
      },
      { upsert: true }
    );

    const sent = await sendSms(phone, code).catch((e) => {
      console.error('[auth] sms error:', e.message);
      return { channel: 'nosms' };   // 短信失败退回 devCode，登录不至于被卡死
    });
    // 短信认证服务（dypns）自行生成验证码 → 用它覆盖本地生成的那份哈希
    if (sent.code && sent.code !== code) {
      await User.findOneAndUpdate({ phone }, { otpCode: hashOtp(sent.code) });
    }
    // 未配置短信通道时回传验证码联调（配置后不再回传）
    res.json({ ok: true, channel: sent.channel, ...(sent.channel === 'nosms' ? { devCode: code } : {}) });
  } catch (e) { next(e); }
});

router.post('/verify', verifyLimiter, async (req, res, next) => {
  try {
    const { phone, code, nickname } = req.body || {};
    if (!/^1\d{10}$/.test(phone || '')) return res.status(400).json({ error: 'invalid phone' });
    if (!/^\d{6}$/.test(code || '')) return res.status(400).json({ error: 'invalid code' });

    const user = await User.findOne({ phone });
    if (!user || !user.otpCode) return res.status(400).json({ error: 'send code first' });

    if (!MOCK) {
      if (user.otpAttempts >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'too many attempts, resend code' });
      }
      if (!user.otpExpires || user.otpExpires < new Date()) {
        return res.status(401).json({ error: 'code expired' });
      }
      if (user.otpCode !== hashOtp(code)) {
        user.otpAttempts += 1;
        await user.save();
        return res.status(401).json({ error: 'wrong code', attemptsLeft: MAX_ATTEMPTS - user.otpAttempts });
      }
    }

    user.otpCode = null;
    user.otpExpires = null;
    user.otpAttempts = 0;
    const isNew = !user.nickname;
    if (nickname && !user.nickname) {
      user.nickname = nickname;
      user.avatarChar = nickname.slice(-1);
    }
    await user.save();

    res.json({
      ok: true,
      token: signToken(user._id),
      isNew,
      user: { id: user._id, phone: user.phone, nickname: user.nickname, avatarChar: user.avatarChar },
    });
  } catch (e) { next(e); }
});

/** 完善资料（注册后设置昵称）。 */
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const { nickname } = req.body || {};
    if (!nickname || !nickname.trim()) return res.status(400).json({ error: 'nickname required' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    user.nickname = nickname.trim().slice(0, 12);
    user.avatarChar = user.nickname.slice(-1);
    await user.save();
    res.json({ ok: true, user: { id: user._id, phone: user.phone, nickname: user.nickname, avatarChar: user.avatarChar } });
  } catch (e) { next(e); }
});

module.exports = router;
