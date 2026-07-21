/**
 * 短信通道（可插拔，按优先级）：
 *
 * ① UniSMS 合一短信（推荐，公共签名免审核）：
 *      UNISMS_ACCESS_KEY   AccessKey（简易鉴权模式）
 *      UNISMS_SIGNATURE    签名，默认「统一验证」（UniSMS 公共签名，无需审核）
 *      UNISMS_TEMPLATE_ID  模板，默认 pub_verif（公共验证码模板，变量 code）
 *
 * ② 阿里云（同一组 ALIYUN_SMS_* 环境变量，按模板 Code 自动分流）：
 *      ALIYUN_SMS_KEY_ID / ALIYUN_SMS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
 *      ALIYUN_SMS_TEMPLATE_JSON（可选）：模板变量 JSON，默认 {"code":"${code}"}；
 *        模板含额外变量时配置，如 {"code":"${code}","min":"5"}，其中 ${code} 会被替换为真实验证码
 *      - 模板 Code 形如 SMS_xxx → 经典短信服务 dysmsapi.SendSms（签名/模板需审核）
 *      - 模板 Code 为纯数字（如 100001）→ 短信认证服务 dypnsapi.SendSmsVerifyCode
 *        （号码认证产品线自带默认签名/模板；验证码由服务端生成并回传，见 sendSms 返回值）
 *
 * 都未配置 → 返回 'nosms'，auth 路由回传 devCode 供客户端联调。
 */
const crypto = require('crypto');

function uniConfigured() {
  return !!process.env.UNISMS_ACCESS_KEY;
}

function aliyunConfigured() {
  return !!(process.env.ALIYUN_SMS_KEY_ID && process.env.ALIYUN_SMS_KEY_SECRET &&
    process.env.ALIYUN_SMS_SIGN_NAME && process.env.ALIYUN_SMS_TEMPLATE_CODE);
}

function configured() {
  return uniConfigured() || aliyunConfigured();
}

/** UniSMS 简易鉴权发送。成功返回 'sent'，失败抛错。 */
async function sendViaUniSms(phone, code) {
  const key = process.env.UNISMS_ACCESS_KEY;
  const url = `https://uni.apistd.com/?action=sms.message.send&accessKeyId=${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: phone,
      signature: process.env.UNISMS_SIGNATURE || '统一验证',
      templateId: process.env.UNISMS_TEMPLATE_ID || 'pub_verif',
      templateData: { code },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (data.code !== '0') {
    console.error('[sms] unisms failed:', data.code, data.message);
    throw new Error(`unisms failed: ${data.code} ${data.message || ''}`);
  }
  return 'sent';
}

/** 阿里云模板变量：默认只有 code；模板含 ${min} 等额外变量时用 ALIYUN_SMS_TEMPLATE_JSON 配置。 */
function aliyunTemplateParam(code) {
  const raw = process.env.ALIYUN_SMS_TEMPLATE_JSON;
  if (!raw) return JSON.stringify({ code });
  return raw.split('${code}').join(code);
}

/** 阿里云 RPC 风格签名（HMAC-SHA1）。 */
function sign(params, secret) {
  const enc = (s) => encodeURIComponent(s)
    .replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
  const query = Object.keys(params).sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const toSign = `POST&%2F&${enc(query)}`;
  return crypto.createHmac('sha1', secret + '&').update(toSign).digest('base64');
}

/**
 * 短信认证服务（dypnsapi.SendSmsVerifyCode）：验证码由阿里云生成并随响应返回，
 * 调用方需用返回的 code 覆盖本地生成的验证码。
 */
async function sendViaDypns(phone) {
  const raw = process.env.ALIYUN_SMS_TEMPLATE_JSON || '{"code":"${code}"}';
  const params = {
    AccessKeyId: process.env.ALIYUN_SMS_KEY_ID,
    Action: 'SendSmsVerifyCode',
    CodeLength: '6',
    Format: 'JSON',
    PhoneNumber: phone,
    ReturnVerifyCode: 'true',
    SignName: process.env.ALIYUN_SMS_SIGN_NAME,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
    // ##code## 占位符 = 由短信认证服务生成验证码
    TemplateParam: raw.split('${code}').join('##code##'),
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    ValidTime: '300',
    Version: '2017-05-25',
  };
  params.Signature = sign(params, process.env.ALIYUN_SMS_KEY_SECRET);
  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://dypnsapi.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (data.Code !== 'OK') {
    console.error('[sms] dypns send failed:', data.Code, data.Message);
    throw new Error(`sms failed: ${data.Code}`);
  }
  const generated = data.Model && (data.Model.VerifyCode || data.Model.verifyCode);
  return { channel: 'sent', code: generated || undefined };
}

/**
 * @returns {Promise<{channel:'sent'|'nosms', code?:string}>}
 *   channel='nosms' 未配置通道；code 非空 = 通道自行生成了验证码（需覆盖本地的）。
 *   发送失败 throws。
 */
async function sendSms(phone, code) {
  if (uniConfigured()) { await sendViaUniSms(phone, code); return { channel: 'sent' }; }
  if (!aliyunConfigured()) return { channel: 'nosms' };
  // 纯数字模板 Code = 短信认证服务（dypnsapi）
  if (/^\d+$/.test(process.env.ALIYUN_SMS_TEMPLATE_CODE || '')) return sendViaDypns(phone);
  const params = {
    AccessKeyId: process.env.ALIYUN_SMS_KEY_ID,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: process.env.ALIYUN_SMS_SIGN_NAME,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
    TemplateParam: aliyunTemplateParam(code),
    Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
    Version: '2017-05-25',
  };
  params.Signature = sign(params, process.env.ALIYUN_SMS_KEY_SECRET);
  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://dysmsapi.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  if (data.Code !== 'OK') {
    console.error('[sms] send failed:', data.Code, data.Message);
    throw new Error(`sms failed: ${data.Code}`);
  }
  return { channel: 'sent' };
}

module.exports = { sendSms, configured };
