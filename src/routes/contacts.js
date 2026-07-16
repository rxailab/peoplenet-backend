/** 联系人 CRUD（按用户隔离）。 */
const express = require('express');
const { Contact, Money, Reminder } = require('../models');

const router = express.Router();

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
      name: name.trim(),
      rel: rel || group || '朋友',
      group: group || rel || '朋友',
      tagline: tagline || '',
      freq: freq || '每月',
      city: city || '',
      tags: tags || [],
      avoid: avoid || undefined,
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
