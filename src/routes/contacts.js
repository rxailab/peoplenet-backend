/** 联系人 CRUD（按用户隔离）。 */
const express = require('express');
const { Contact, Money, Reminder } = require('../models');

const router = express.Router();

/** avoid（禁忌）只接受 { food: string[], topics: string[] } 结构，其余一律丢弃。 */
function sanitizeAvoid(avoid) {
  if (!avoid || typeof avoid !== 'object' || Array.isArray(avoid)) return undefined;
  const pick = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, 20) : []);
  return { food: pick(avoid.food), topics: pick(avoid.topics) };
}

router.get('/', async (req, res, next) => {
  try {
    const list = await Contact.find({ userId: req.userId }).sort({ createdAt: 1 });
    res.json(list);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, rel, group, tagline, freq, city, tags, avoid } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const doc = await Contact.create({
      userId: req.userId,
      name: name.trim().slice(0, 20),
      rel: rel || group || '朋友',
      group: group || rel || '朋友',
      tagline: tagline || '',
      freq: freq || '每月',
      city: city || '',
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string').slice(0, 20) : [],
      avoid: sanitizeAvoid(avoid),
    });
    res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'contact exists' });
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name', 'rel', 'group', 'tagline', 'freq', 'city', 'tags', 'avoid', 'lastContactAt'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    if ('avoid' in patch) patch.avoid = sanitizeAvoid(patch.avoid);
    if ('name' in patch) {
      if (!patch.name || !String(patch.name).trim()) return res.status(400).json({ error: 'name required' });
      patch.name = String(patch.name).trim().slice(0, 20);
    }
    const doc = await Contact.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      patch,
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(doc);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await Contact.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'not found' });
    // 级联清理该联系人的账目与提醒
    await Money.deleteMany({ userId: req.userId, contactId: doc._id });
    await Reminder.deleteMany({ userId: req.userId, contactId: doc._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
