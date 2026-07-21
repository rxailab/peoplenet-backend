/**
 * 语音解析代理：App 上传识别文本 + 联系人名单，服务端调通义千问抽取结构化操作。
 * DashScope API-KEY 只存在服务端，客户端不再内置。
 * 与客户端约定一致：日期由客户端本地确定性换算，模型只原样返回 date_word。
 */
const express = require('express');

const router = express.Router();

const ENDPOINT = process.env.QWEN_ENDPOINT
  || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = process.env.QWEN_MODEL || 'qwen-turbo';

function systemPrompt(names, today) {
  return `
你是一个关系管理 App 的中文语音助手解析器。用户会说一句话，可能包含以下几类操作（可同时出现多个）：
1) 提醒 / 约见：「周六提醒我和老周钓鱼」
2) 人情往来：借出「借给老周两千」/ 借入「我找老周借了五百」/ 送礼「送了妈妈一条羊绒围巾」/ 收礼「收了王敏 600 的礼金」/ 收回借出「把老周借的两千收回来」
3) 新建联系人：「新建联系人王强，健身房认识的朋友」
4) 标记已联系：「我刚和妈妈通了电话」

已知联系人：${names.join('、')}。
语音转写常有同音错别字：句中人名与已知联系人读音相同或相近时，按已知联系人的写法返回。
新建联系人时 person 用新联系人的名字（不必在已知列表里）；其余操作 person 必须是已知联系人。
句子可能夹杂无关闲聊，只提取与上述操作相关的部分。
今天是 ${today}。

只输出一个 JSON 对象，不要任何解释或 Markdown 代码块：
{
  "person": "本句操作针对的联系人姓名；没有则 null",
  "new_contact": { "name": "王强", "relation": "家人/朋友/同事/同学 之一，判断不了用 朋友", "note": "一句备注" } 或 null,
  "contacted": true 或 false,
  "reminder": { "title": "简短标题", "date_word": "用户原话里的日期词，原样返回、禁止换算：如 周六 / 明天 / 下周三 / 8月4日；没说则 null", "time": "如 上午 9:00，缺省用 上午 9:00" } 或 null,
  "money": { "amount": 金额数字(元,整数,没有则 null), "kind": "lend/borrow/give/receive/collect", "item": "实物礼品名或 null" } 或 null
}
没有对应信息的字段用 null / false。person 为 null 且 new_contact 为 null 时，其它字段也应为 null。
`.trim();
}

router.post('/parse', async (req, res, next) => {
  try {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) return res.status(503).json({ error: 'voice parse not configured' });

    const { text, contacts, today } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
    if (text.length > 2000) return res.status(400).json({ error: 'text too long' });
    const names = (Array.isArray(contacts) ? contacts : [])
      .filter((n) => typeof n === 'string' && n.trim())
      .slice(0, 500)
      .map((n) => n.slice(0, 20));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let resp;
    try {
      resp = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt(names, String(today || '').slice(0, 40)) },
            { role: 'user', content: text },
          ],
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[qwen]', resp.status, body.slice(0, 200));
      return res.status(502).json({ error: 'qwen upstream error' });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return res.status(502).json({ error: 'qwen bad response' });
    res.json(JSON.parse(content.slice(start, end + 1)));
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'qwen timeout' });
    next(e);
  }
});

module.exports = router;
