/** 人情账（借出/借入/送礼/收礼）CRUD + 状态流转。 */
const express = require('express');
const { Money, Contact } = require('../models');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = { userId: req.userId };
    if (req.query.contactId) filter.contactId = req.query.contactId;
    const list = await Money.find(filter).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { contactId, type, amount, isPhysical, itemName, estValue, date, note, event, reminderDate } = req.body || {};
    if (!['lend', 'borrow', 'give', 'receive'].includes(type)) return res.status(400).json({ error: 'invalid type' });
    const contact = await Contact.findOne({ _id: contactId, userId: req.userId });
    if (!contact) return res.status(400).json({ error: 'unknown contact' });
    const doc = await Money.create({
      userId: req.userId,
      contactId,
      type,
      amount: amount || 0,
      isPhysical: !!isPhysical,
      itemName: itemName || '',
      estValue: estValue || 0,
      date: date || '',
      note: note || '',
      event: event || '',
      reminderDate: reminderDate || '',
      loanStatus: type === 'lend' || type === 'borrow' ? 'unpaid' : null,
      giftReturn: type === 'receive' ? 'pending' : null,
    });
    res.status(201).json(doc);
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['amount', 'isPhysical', 'itemName', 'estValue', 'date', 'note', 'event', 'reminderDate', 'loanStatus', 'giftReturn'];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    const doc = await Money.findOneAndUpdate(
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
    const doc = await Money.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
