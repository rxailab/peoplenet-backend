/**
 * 端到端冒烟测试：内存 MongoDB + 真实 HTTP 请求跑完整链路。
 * 运行：npm test
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

async function main() {
  const mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri('peoplenet');
  process.env.JWT_SECRET = 'test-secret';
  process.env.MOCK_OTP = 'false';   // 强校验模式：错码拒绝，devCode 才能过

  const mongoose = require('mongoose');
  const { app } = require('../src/server');
  await mongoose.connect(process.env.MONGODB_URI);
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api`;

  let passed = 0;
  const check = (name, cond, extra) => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { console.error(`  ✗ ${name}`, extra ?? ''); process.exitCode = 1; }
  };
  const j = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('health:');
  const h = await j('GET', '/health');
  check('health ok + mongo connected', h.body.ok === true && h.body.mongo === 'connected', h.body);

  console.log('auth (enforced OTP):');
  const sc = await j('POST', '/auth/send-code', { phone: '13800138000' });
  check('send-code returns devCode (nosms channel)', /^\d{6}$/.test(sc.body.devCode || '') && sc.body.channel === 'nosms', sc.body);
  const resend = await j('POST', '/auth/send-code', { phone: '13800138000' });
  check('resend within 60s → 429', resend.status === 429, resend.body);
  const bad = await j('POST', '/auth/verify', { phone: '13800138000', code: 'abc' });
  check('verify rejects bad code format', bad.status === 400);
  const wrongCode = sc.body.devCode === '000000' ? '111111' : '000000';
  const wrong = await j('POST', '/auth/verify', { phone: '13800138000', code: wrongCode });
  check('wrong code → 401 + attemptsLeft', wrong.status === 401 && wrong.body.attemptsLeft === 4, wrong.body);
  const v = await j('POST', '/auth/verify', { phone: '13800138000', code: sc.body.devCode, nickname: '阿哲' });
  check('correct devCode → token + isNew', typeof v.body.token === 'string' && v.body.user.nickname === '阿哲' && v.body.isNew === true, v.body);
  const token = v.body.token;
  const replay = await j('POST', '/auth/verify', { phone: '13800138000', code: sc.body.devCode });
  check('code single-use (replay rejected)', replay.status === 400, replay.body);
  const prof = await j('PUT', '/auth/profile', { nickname: '哲哥' }, token);
  check('update profile nickname', prof.body.user && prof.body.user.nickname === '哲哥', prof.body);
  const noAuth = await j('GET', '/contacts');
  check('contacts requires auth', noAuth.status === 401);

  console.log('contacts:');
  const c1 = await j('POST', '/contacts', { name: '老周', rel: '老友', group: '朋友', tagline: '答应一起钓鱼' }, token);
  check('create contact', c1.status === 201 && c1.body.name === '老周', c1.body);
  const dup = await j('POST', '/contacts', { name: '老周' }, token);
  check('duplicate contact 409', dup.status === 409);
  const cl = await j('GET', '/contacts', null, token);
  check('list contacts', cl.body.length === 1);
  const cu = await j('PUT', `/contacts/${c1.body._id}`, { tagline: '钓鱼约定还在' }, token);
  check('update contact', cu.body.tagline === '钓鱼约定还在');

  console.log('money:');
  const m1 = await j('POST', '/money', { contactId: c1.body._id, type: 'lend', amount: 2000, date: '7月16日', reminderDate: '8月4日' }, token);
  check('create lend, status unpaid', m1.status === 201 && m1.body.loanStatus === 'unpaid', m1.body);
  const m2 = await j('POST', '/money', { contactId: c1.body._id, type: 'receive', amount: 800, event: '我乔迁' }, token);
  check('create receive, giftReturn pending', m2.body.giftReturn === 'pending');
  const badType = await j('POST', '/money', { contactId: c1.body._id, type: 'steal', amount: 1 }, token);
  check('invalid money type 400', badType.status === 400);
  const mu = await j('PUT', `/money/${m1.body._id}`, { loanStatus: 'paid' }, token);
  check('mark loan paid', mu.body.loanStatus === 'paid');
  const ml = await j('GET', `/money?contactId=${c1.body._id}`, null, token);
  check('list money by contact', ml.body.length === 2);

  console.log('reminders:');
  const r1 = await j('POST', '/reminders', { contactId: c1.body._id, title: '和老周钓鱼', date: '周六 7月18日' }, token);
  check('create reminder', r1.status === 201 && r1.body.title === '和老周钓鱼');
  const rd = await j('PUT', `/reminders/${r1.body._id}`, { done: true }, token);
  check('mark reminder done', rd.body.done === true);

  console.log('isolation:');
  const sc2 = await j('POST', '/auth/send-code', { phone: '13900139000' });
  const v2 = await j('POST', '/auth/verify', { phone: '13900139000', code: sc2.body.devCode });
  const other = await j('GET', '/contacts', null, v2.body.token);
  check('other user sees no contacts', other.body.length === 0);

  console.log('cascade delete:');
  const del = await j('DELETE', `/contacts/${c1.body._id}`, null, token);
  check('delete contact', del.body.ok === true);
  const mAfter = await j('GET', '/money', null, token);
  const rAfter = await j('GET', '/reminders', null, token);
  check('money cascaded', mAfter.body.length === 0);
  check('reminders cascaded', rAfter.body.length === 0);

  console.log('voice (unconfigured → 503):');
  const vp = await j('POST', '/voice/parse', { text: '周六提醒我和老周钓鱼', contacts: ['老周'] }, token);
  check('voice parse 503 without key', vp.status === 503, vp);

  server.close();
  await mongoose.disconnect();
  await mem.stop();
  console.log(`\n${passed} checks passed${process.exitCode ? ' (WITH FAILURES)' : ', all green ✅'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
