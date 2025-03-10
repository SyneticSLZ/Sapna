// models.js - Database models for campaigns and related data
const mongoose = require('mongoose');

// Campaign Schema
const campaignSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Draft', 'Scheduled', 'Active', 'Paused', 'Completed', 'Failed'],
    default: 'Draft'
  },
  mailboxId: String,
  leadCount: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  openCount: { type: Number, default: 0 },
  clickCount: { type: Number, default: 0 },
  replyCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  startDate: Date,
  settings: {
    trackOpens: { type: Boolean, default: true },
    trackClicks: { type: Boolean, default: true },
    stopOnReply: { type: Boolean, default: true },
    stopOnClick: { type: Boolean, default: false },
    sendInterval: { type: Number, default: 60 } // seconds
  },
  initialEmail: {
    subject: String,
    body: String
  },
  followUpEmails: [{
    subject: String,
    body: String,
    waitDuration: Number,
    waitUnit: { type: String, enum: ['minutes', 'hours', 'days', 'weeks'] },
    status: { 
      type: String, 
      enum: ['Pending', 'Scheduled', 'Sent', 'Failed'],
      default: 'Pending'
    },
    scheduledFor: Date
  }]
});

// Email Queue Schema
const emailQueueSchema = new mongoose.Schema({
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign',
    required: true
  },
  to: { type: String, required: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  threadId: { type: String, default: null },
  messageId: { type: String, default: null },
  scheduledFor: { type: Date, required: true, index: true },
  status: { 
    type: String, 
    enum: ['Pending', 'Processing', 'Sent', 'Failed'],
    default: 'Pending'
  },
  type: { 
    type: String, 
    enum: ['Initial', 'FollowUp'],
    default: 'Initial'
  },
  followUpIndex: Number,
  metadata: Object,
  attempts: { type: Number, default: 0 },
  lastAttemptAt: Date,
  sentAt: Date,
  error: String
});

// Lead Schema
const leadSchema = new mongoose.Schema({
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign',
    required: true
  },
  email: { type: String, required: true },
  firstName: String,
  lastName: String,
  company: String,
  title: String,
  website: String,
  industry: String,
  revenue: String,
  employees: String,
  city: String,
  state: String,
  status: { 
    type: String, 
    enum: ['Active', 'Replied', 'Unsubscribed', 'Bounced'],
    default: 'Active'
  },
  opens: [{ date: Date }],
  clicks: [{ 
    date: Date,
    url: String 
  }],
  replies: [{
    date: { type: Date, default: Date.now },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailQueue' },
    content: { type: String } // Add field for reply content
  }],
  lastActivity: Date,
  metadata: Object
});

// Analytics Event Schema
const analyticsEventSchema = new mongoose.Schema({
  eventType: { 
    type: String, 
    enum: ['Open', 'Click', 'Reply', 'Bounce', 'Unsubscribe'],
    required: true
  },
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign'
  },
  leadId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Lead'
  },
  emailId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'EmailQueue'
  },
  timestamp: { type: Date, default: Date.now },
  metadata: Object
});

const Campaign = mongoose.model('Campaign', campaignSchema);
const EmailQueue = mongoose.model('EmailQueue', emailQueueSchema);
const Lead = mongoose.model('Lead', leadSchema);
const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

module.exports = { Campaign, EmailQueue, Lead, AnalyticsEvent };