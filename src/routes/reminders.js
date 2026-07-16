/** 提醒 CRUD。 */
const express = require('express');
const { Reminder, Contact } = require('../models');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = { userId: req.userId };
    if (req.query.contactId) filter.contactId = req.query.contactId;
    const list = await Reminder.find(filter).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { contactId, title, date, time } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
    const contact = await Contact.findOne({ _id: contactId, userId: req.userId });
    if (!contact) return res.status(400).json({ error: 'unknown contact' });
    const doc = await Reminder.create({
      userId: req.userId, contactId,
      title: title.trim(), date: date || '', time: time || '上午 9:00',
    });
    res.status(201).json(doc);
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['title', 'date', 'time', 'done'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    const doc = await Reminder.findOneAndUpdate(
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
    const doc = await Reminder.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
