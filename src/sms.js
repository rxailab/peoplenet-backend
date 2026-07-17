/**
 * 短信通道（可插拔）。
 * 配置了阿里云短信凭据（下列 4 个环境变量）即真实发送；未配置则返回 'nosms'，
 * 由 auth 路由把 devCode 回传给客户端联调。
 *
 *   ALIYUN_SMS_KEY_ID        AccessKey ID
 *   ALIYUN_SMS_KEY_SECRET    AccessKey Secret
 *   ALIYUN_SMS_SIGN_NAME     短信签名（如 人际关系网）
 *   ALIYUN_SMS_TEMPLATE_CODE 模板 CODE（如 SMS_123456789，模板变量 ${code}）
 */
const crypto = require('crypto');

function configured() {
  return !!(process.env.ALIYUN_SMS_KEY_ID && process.env.ALIYUN_SMS_KEY_SECRET &&
    process.env.ALIYUN_SMS_SIGN_NAME && process.env.ALIYUN_SMS_TEMPLATE_CODE);
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
  if (!configured()) return 'nosms';
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
