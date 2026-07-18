/**
 * 短信通道（可插拔，按优先级）：
 *
 * ① UniSMS 合一短信（推荐，公共签名免审核）：
 *      UNISMS_ACCESS_KEY   AccessKey（简易鉴权模式）
 *      UNISMS_SIGNATURE    签名，默认「统一验证」（UniSMS 公共签名，无需审核）
 *      UNISMS_TEMPLATE_ID  模板，默认 pub_verif（公共验证码模板，变量 code）
 *
 * ② 阿里云短信（需签名/模板审核）：
 *      ALIYUN_SMS_KEY_ID / ALIYUN_SMS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
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

/** 阿里云 RPC 风格签名（HMAC-SHA1）。 */
function sign(params, secret) {
  const enc = (s) => encodeURIComponent(s)
    .replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
  const query = Object.keys(params).sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const toSign = `POST&%2F&${enc(query)}`;
  return crypto.createHmac('sha1', secret + '&').update(toSign).digest('base64');
}

/** @returns 'sent' 真实短信已发 | 'nosms' 未配置通道 | throws 发送失败 */
async function sendSms(phone, code) {
  if (uniConfigured()) return sendViaUniSms(phone, code);
  if (!aliyunConfigured()) return 'nosms';
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
    TemplateParam: JSON.stringify({ code }),
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
  return 'sent';
}

module.exports = { sendSms, configured };
