/** Mongoose 模型：用户 / 联系人 / 人情账 / 提醒。 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    nickname: { type: String, default: '' },
    avatarChar: { type: String, default: '' },
    otpCode: { type: String, default: null },
    otpExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

const ContactSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    rel: { type: String, default: '朋友' },      // 显示关系：家人/老友/同事…
    group: { type: String, default: '朋友' },    // 分组
    tagline: { type: String, default: '' },      // 一句话备注
    freq: { type: String, default: '每月' },     // 联系频率
    city: { type: String, default: '' },
    tags: { type: [String], default: [] },
    avoid: {                                     // 禁忌
      food: { type: [String], default: [] },
      topics: { type: [String], default: [] },
    },
    lastContactAt: { type: Date, default: null },
  },
  { timestamps: true }
);
ContactSchema.index({ userId: 1, name: 1 }, { unique: true });

const MoneySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    type: { type: String, enum: ['lend', 'borrow', 'give', 'receive'], required: true },
    amount: { type: Number, default: 0 },        // 元；实物时为 0
    isPhysical: { type: Boolean, default: false },
    itemName: { type: String, default: '' },
    estValue: { type: Number, default: 0 },
    date: { type: String, default: '' },         // 展示日期，如 "7月16日"
    note: { type: String, default: '' },
    event: { type: String, default: '' },        // 礼簿事件，如 "我乔迁"
    reminderDate: { type: String, default: '' },
    loanStatus: { type: String, enum: ['unpaid', 'partial', 'paid', null], default: null },
    giftReturn: { type: String, enum: ['pending', 'returned', null], default: null },
  },
  { timestamps: true }
);

const ReminderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    title: { type: String, required: true },
    date: { type: String, default: '' },         // "周六 7月18日"
    time: { type: String, default: '上午 9:00' },
    done: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = {
  User: mongoose.model('User', UserSchema),
  Contact: mongoose.model('Contact', ContactSchema),
  Money: mongoose.model('Money', MoneySchema),
  Reminder: mongoose.model('Reminder', ReminderSchema),
};
