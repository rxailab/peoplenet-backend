/**
 * 手机号 + 验证码登录（与 App 现有流程一致）。
 * 原型模式（MOCK_OTP != "false"）：不接短信网关，任意 6 位验证码可登录；
 * send-code 会把验证码回传在响应里（devCode），方便联调。
 */
const express = require('express');
const { User } = require('../models');
const { signToken } = require('../middleware/auth');

const router = express.Router();
const MOCK = process.env.MOCK_OTP !== 'false';

router.post('/send-code', async (req, res, next) => {
  try {
    const { phone } = req.body || {};
    if (!/^1\d{10}$/.test(phone || '')) return res.status(400).json({ error: 'invalid phone' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await User.findOneAndUpdate(
      { phone },
      { phone, otpCode: code, otpExpires: new Date(Date.now() + 5 * 60 * 1000) },
      { upsert: true }
    );
    // 原型：没有短信通道，验证码直接回传（生产要接 SMS 并去掉 devCode）
    res.json({ ok: true, ...(MOCK ? { devCode: code } : {}) });
  } catch (e) { next(e); }
});

router.post('/verify', async (req, res, next) => {
  try {
    const { phone, code, nickname } = req.body || {};
    if (!/^1\d{10}$/.test(phone || '')) return res.status(400).json({ error: 'invalid phone' });
    if (!/^\d{6}$/.test(code || '')) return res.status(400).json({ error: 'invalid code' });

    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ error: 'send code first' });

    const codeOk = MOCK
      ? true   // 原型：任意 6 位
      : user.otpCode === code && user.otpExpires && user.otpExpires > new Date();
    if (!codeOk) return res.status(401).json({ error: 'wrong or expired code' });

    user.otpCode = null;
    user.otpExpires = null;
    if (nickname && !user.nickname) {
      user.nickname = nickname;
      user.avatarChar = nickname.slice(-1);
    }
    await user.save();

    res.json({
      ok: true,
      token: signToken(user._id),
      user: { id: user._id, phone: user.phone, nickname: user.nickname, avatarChar: user.avatarChar },
    });
  } catch (e) { next(e); }
});

module.exports = router;
