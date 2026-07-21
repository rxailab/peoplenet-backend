/**
 * 线上验收：对已部署的 Render 服务跑核心链路。
 * 运行：BASE=https://peoplenet-api.onrender.com node test/smoke_live.js
 */
const BASE = (process.env.BASE || 'https://peoplenet-api.onrender.com') + '/api';

async function main() {
  let passed = 0;
  const check = (name, cond, extra) => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { console.error(`  ✗ ${name}`, JSON.stringify(extra ?? '').slice(0, 300)); process.exitCode = 1; }
  };
  const j = async (method, path, body, token) => {
    const r = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('base:', BASE);
  console.log('health:');
  const h = await j('GET', '/health');
  check('health ok + mongo connected', h.body.ok === true && h.body.mongo === 'connected', h.body);

  console.log('auth:');
  const phone = '138' + String(Math.floor(10000000 + Math.random() * 89999999)); // 随机测试号，不污染真实账号
  const sc = await j('POST', '/auth/send-code', { phone });
  // 强校验模式：未配短信通道时服务端回传 devCode；配了真实短信则无法自动接码，只能人工验收
  const code = sc.body.devCode;
  if (!code) {
    console.error('  ✗ 无 devCode（已配置真实短信通道或发码失败），登录链路需人工验收', JSON.stringify(sc.body));
    process.exit(1);
  }
  const v = await j('POST', '/auth/verify', { phone, code, nickname: '验收' });
  check('login (devCode 强校验)', typeof v.body.token === 'string', v.body);
  const token = v.body.token;

  console.log('contacts:');
  const c = await j('POST', '/contacts', { name: '老周', rel: '老友', tagline: '线上验收' }, token);
  check('create contact', c.status === 201, c.body);

  console.log('money:');
  const m = await j('POST', '/money', { contactId: c.body._id, type: 'lend', amount: 2000, date: '7月16日' }, token);
  check('lend 2000', m.status === 201 && m.body.loanStatus === 'unpaid', m.body);

  console.log('reminders:');
  const r = await j('POST', '/reminders', { contactId: c.body._id, title: '和老周钓鱼', date: '周六 7月18日' }, token);
  check('reminder', r.status === 201, r.body);

  console.log('voice parse (real Qwen through server):');
  const vp = await j('POST', '/voice/parse', {
    text: '周六提醒我和老周去钓鱼，顺便把借他的两千收一下',
    contacts: ['老周', '妈妈'],
    today: '7月16日 周四',
  }, token);
  check('person=老周', vp.body.person === '老周', vp.body);
  check('reminder extracted', vp.body.reminder && vp.body.reminder.title, vp.body.reminder);
  check('money collect 2000', vp.body.money && vp.body.money.kind === 'collect' && vp.body.money.amount === 2000, vp.body.money);

  console.log('cleanup:');
  const del = await j('DELETE', `/contacts/${c.body._id}`, null, token);
  check('cascade delete', del.body.ok === true);

  console.log(`\n${passed} checks${process.exitCode ? ' (WITH FAILURES)' : ' — 线上验收通过 ✅'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
