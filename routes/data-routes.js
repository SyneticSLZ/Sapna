// // campaign-routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { google } = require('googleapis'); // Add Google APIs for Gmail
const { User } = require('../models/user');
const axios = require('axios');
const { Campaign, EmailQueue, Lead, AnalyticsEvent } = require('../models');
require('dotenv').config(); // Ensure environment variables are loaded

// Initialize OAuth2 client (move this to a shared config if reused elsewhere)
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);


router.post('/verify-email-hunter', async (req, res) => {
  const { email } = req.body;

  if (!email) {
      return res.status(400).json({ error: 'Email is required' });
  }

  try {
      const response = await axios.get('https://api.hunter.io/v2/email-verifier', {
          params: {
              email,
              api_key: process.env.HUNTER_API_KEY
          }
      });

      res.json(response.data);
  } catch (error) {
      console.error('Hunter.io API error:', error);
      res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Helper function to check for replies
async function checkForReplies(email, user) {
  if (!email.threadId) return false;
 console.log(user)
  // Find the correct token for this mailbox
  const tokenData = user.tokens[0]
  if (!tokenData) {
    console.error(`No token found for mailbox ${email.mailboxId}`);
    return false;
  }

  // Set up OAuth2 client with user's tokens
  oAuth2Client.setCredentials({
    access_token: user.tokens[0].accessToken,
    refresh_token: user.tokens[0].refreshToken,
    expiry_date: user.tokens[0].expiry?.getTime()
  });

  // Refresh token if expired
  if (user.tokens[0].expiry < new Date()) {
    console.log('Token expired, refreshing...');
    const { credentials } = await oAuth2Client.refreshAccessToken();
    user.tokens[0].accessToken = credentials.access_token;
    if (credentials.refresh_token) {
        user.tokens[0].refreshToken = credentials.refresh_token;
    }
    tokenData.expiry = new Date(credentials.expiry_date);
    await user.save();
    oAuth2Client.setCredentials(credentials);
  }

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: email.threadId,
      format: 'full' // Ensure full message data is returned
    });

    const messages = thread.data.messages || [];
    if (messages.length <= 1) {
      return { hasReply: false, replyContent: null };
    }

    // Find the reply (assume the last message is the reply for simplicity)
    const replyMessage = messages[messages.length - 1]; // Latest message in thread
    const payload = replyMessage.payload || {};
    let replyContent = '';

    // Extract text content from the reply
    if (payload.parts) {
      // Handle multipart messages (e.g., text/plain or text/html)
      const textPart = payload.parts.find(part => part.mimeType === 'text/plain') || 
                       payload.parts.find(part => part.mimeType === 'text/html');
      if (textPart && textPart.body && textPart.body.data) {
        replyContent = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    } else if (payload.body && payload.body.data) {
      // Handle simple messages with no parts
      replyContent = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    console.log(`Reply detected for email ${email._id} in thread ${email.threadId}`);
    return { hasReply: true, replyContent };
  } catch (error) {
    console.error(`Error checking thread ${email.threadId}:`, error);
    return { hasReply: false, replyContent: null };
  }
}
// Dashboard endpoint - summary of user's campaigns and stats
router.get('/dashboard', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch all campaigns associated with the user
    const campaigns = await Campaign.find({ userId: user._id });
    const campaignIds = campaigns.map(campaign => campaign._id);

    // Fetch related data
    const emails = await EmailQueue.find({ 
      campaignId: { $in: campaignIds },
      status: 'Sent' // Only check sent emails
    });
    const leads = await Lead.find({ campaignId: { $in: campaignIds } });

    // Check for replies and update leads
    for (const email of emails) {
        if (email.threadId) {
          const lead = leads.find(l => l.email === email.to && l.campaignId.equals(email.campaignId));
          if (lead) {
            // Ensure replies is an array
            if (!Array.isArray(lead.replies)) {
              lead.replies = [];
            }
  
            // Check if this email already has a reply recorded
            const alreadyReplied = lead.replies.some(r => r.emailId && r.emailId.equals(email._id));
            if (alreadyReplied) {
              console.log(`Skipping reply check for email ${email._id} - already replied`);
              continue; // Skip to the next email
            }
  
            // Only check Gmail if no reply is recorded yet
            const { hasReply, replyContent } = await checkForReplies(email, user);
            if (hasReply) {
              lead.replies.push({ 
                date: new Date(), 
                emailId: email._id,
                content: replyContent
              });
              await lead.save();
              console.log(`Updated lead ${lead.email} with reply for email ${email._id}`);
            }
          } else {
            console.log(`No lead found for email ${email.to} in campaign ${email.campaignId}`);
          }
        }
      }

      const leadsWithReplies = leads
      .filter(lead => lead.replies && lead.replies.length > 0)
      .map(lead => ({
        ...lead.toObject(),
        replies: lead.replies.sort((a, b) => b.date - a.date) // Sort replies within each lead
      }))
      .sort((a, b) => {
        const aLatest = a.replies[0]?.date || 0;
        const bLatest = b.replies[0]?.date || 0;
        return bLatest - aLatest; // Sort leads by most recent reply
      });


    // Aggregate dashboard statistics
    const stats = {
      totalCampaigns: campaigns.length,
      totalEmailsSent: emails.length,
      totalLeads: leads.length,
      totalReplies: leads.reduce((acc, lead) => acc + lead.replies.length, 0),
      totalOpens: leads.reduce((acc, lead) => acc + lead.opens.length, 0),
      totalClicks: leads.reduce((acc, lead) => acc + lead.clicks.length, 0),
    };

    res.json({ stats, campaigns, emails, leads, leadsWithReplies });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Analytics endpoint - detailed analytics for all campaigns or specific campaign
router.get('/analytics', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Find campaigns associated with the user
    const campaigns = await Campaign.find({ userId: user._id });
    const campaignIds = campaigns.map(campaign => campaign._id);

    // Fetch analytics events
    const analyticsEvents = await AnalyticsEvent.find({ campaignId: { $in: campaignIds } });

    res.json({ analyticsEvents });
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
// const express = require('express');
// const router = express.Router();
// const mongoose = require('mongoose');
// const auth = require('../auth');
// const { User } = require('../models/user')
// const { Campaign, EmailQueue, Lead, AnalyticsEvent } = require('../models');


// // Dashboard endpoint - summary of user's campaigns and stats
// router.get('/dashboard', async (req, res) => {
//     try {
//         const { email } = req.query;
//         if (!email) {
//             return res.status(400).json({ error: "Email is required" });
//         }

//         // Find user by email
//         const user = await User.findOne({ email });
//         if (!user) {
//             return res.status(404).json({ error: "User not found" });
//         }

//         // Fetch all campaigns associated with the user
//         const campaigns = await Campaign.find({ userId: user._id });

//         // Extract campaign IDs for lookup
//         const campaignIds = campaigns.map(campaign => campaign._id);

//         // Fetch related data
//         const emails = await EmailQueue.find({ campaignId: { $in: campaignIds } });
//         const leads = await Lead.find({ campaignId: { $in: campaignIds } });

//         // Aggregate dashboard statistics
//         const stats = {
//             totalCampaigns: campaigns.length,
//             totalEmailsSent: emails.length,
//             totalLeads: leads.length,
//             totalReplies: leads.reduce((acc, lead) => acc + lead.replies.length, 0),
//             totalOpens: leads.reduce((acc, lead) => acc + lead.opens.length, 0),
//             totalClicks: leads.reduce((acc, lead) => acc + lead.clicks.length, 0),
//         };

//         res.json({ stats, campaigns, emails, leads });
//     } catch (error) {
//         console.error("Dashboard Error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });
// // Analytics endpoint - detailed analytics for all campaigns or specific campaign
// router.get('/analytics', async (req, res) => {
//     try {
//         const { email } = req.query;
//         if (!email) {
//             return res.status(400).json({ error: "Email is required" });
//         }

//         // Find user by email
//         const user = await User.findOne({ email });
//         if (!user) {
//             return res.status(404).json({ error: "User not found" });
//         }

//         // Find campaigns associated with the user
//         const campaigns = await Campaign.find({ userId: user._id });
//         const campaignIds = campaigns.map(campaign => campaign._id);

//         // Fetch analytics events
//         const analyticsEvents = await AnalyticsEvent.find({ campaignId: { $in: campaignIds } });

//         res.json({ analyticsEvents });
//     } catch (error) {
//         console.error("Analytics Error:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

// module.exports = router;


// module.exports = router;