// queue.js - Email queue management
const { EmailQueue, Campaign, Lead, AnalyticsEvent } = require('./models');
const { google } = require('googleapis');
const { User } = require('./models/user');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

// Initialize MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Load OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

async function getUserSignature(gmail, mailboxId) {
  try {
    const response = await gmail.users.settings.sendAs.get({
      userId: 'me',
      sendAsEmail: mailboxId
    });
    
    return response.data.signature || '';
  } catch (error) {
    console.error('Error fetching signature:', error);
    return '';
  }
}

async function checkForReplies(email) {
  if (!email.threadId) return false;

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  try {
    // Get thread details
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: email.threadId,
    });

    // Check if there are messages beyond the original sent email
    const messages = thread.data.messages || [];
    if (messages.length > 1) { // More than just the sent email
      console.log(`Reply detected for email ${email._id} in thread ${email.threadId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error checking thread ${email.threadId}:`, error);
    return false;
  }
}

// Process emails in queue
async function processEmailQueue() {
  try {
    // Find emails that are scheduled to be sent now or in the past
    const pendingEmails = await EmailQueue.find({
      status: 'Pending',
      scheduledFor: { $lte: new Date() },
      attempts: { $lt: 3 } // Limit retry attempts
    }).sort({ scheduledFor: 1 }).limit(10); // Process in batches
    
    console.log(`Processing ${pendingEmails.length} pending emails`);
    
    for (const email of pendingEmails) {
      try {
        // Mark as processing to prevent duplicate processing
        email.status = 'Processing';
        email.attempts += 1;
        email.lastAttemptAt = new Date();
        await email.save();
        
        // Get campaign details
        const campaign = await Campaign.findById(email.campaignId);
        if (!campaign) {
          throw new Error('Campaign not found');
        }
        
        // Get user with tokens
        const user = await User.findById(campaign.userId);
        if (!user) {
          throw new Error('User not found');
        }
        
        // Find the correct token for this mailbox
        const tokenData = user.tokens.find(t => t.email === campaign.mailboxId);
        if (!tokenData) {
          throw new Error('Email account not found');
        }
        
        // Set up OAuth2 client with tokens
        oAuth2Client.setCredentials({
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken,
          expiry_date: tokenData.expiry?.getTime()
        });
        
        // Check if token is expired and refresh if needed
        if (tokenData.expiry < new Date()) {
          console.log('Token expired, refreshing...');
          const { credentials } = await oAuth2Client.refreshAccessToken();
          
          // Update token in database
          tokenData.accessToken = credentials.access_token;
          if (credentials.refresh_token) {
            tokenData.refreshToken = credentials.refresh_token;
          }
          tokenData.expiry = new Date(credentials.expiry_date);
          await user.save();
          
          // Update client credentials
          oAuth2Client.setCredentials(credentials);
        }
        
        // Initialize Gmail API
        const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
        const signature = await getUserSignature(gmail, campaign.mailboxId);
        // Add tracking pixels if enabled
        let trackingBody = email.body;
        if (campaign.settings.trackOpens) {
          const trackingId = crypto.randomBytes(16).toString('hex');
          const timestamp = Date.now();
          const trackingPixel = `<img src="${process.env.BASE_URL}/track-open?cid=${campaign._id}&eid=${email._id}&tid=${trackingId}&ts=${timestamp}" width="1" height="1" alt="" style="display:none">`;
          const preloadTag = `<link rel="preload" href="${process.env.BASE_URL}/track-open?cid=${campaign._id}&eid=${email._id}&tid=${trackingId}&ts=${timestamp}" as="image">`;
          trackingBody = `${preloadTag}${trackingBody}${trackingPixel}`;
        }

        if (campaign.settings.trackClicks) {
          trackingBody = trackingBody.replace(
            /<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>(.*?)<\/a>/gi,
            (match, url, attrs, text) => {
              const trackingId = crypto.randomBytes(16).toString('hex');
              const trackingUrl = `${process.env.BASE_URL}/track-click?cid=${campaign._id}&eid=${email._id}&tid=${trackingId}&url=${encodeURIComponent(url)}`;
              return `<a href="${trackingUrl}"${attrs}>${text}</a>`;
            }
          );
        }
        const emailBodyWithSignature = `${trackingBody}<br><br>${signature}`;
        
        const emailLines = [
          `To: ${email.to}`,
          'Content-Type: text/html; charset=utf-8',
          `Subject: ${email.subject}`,
          '',
          emailBodyWithSignature
        ];
        // Create email content
        // const emailLines = [
        //   `To: ${email.to}`,
        //   'Content-Type: text/html; charset=utf-8',
        //   `Subject: ${email.subject}`,
        //   '',
        //   trackingBody
        // ];
        
        const emailContent = emailLines.join('\r\n');
        
        // Encode email
        const encodedMessage = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        
        // Send email
        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedMessage,
          },
        });
        const threadId = response.data.threadId;
        // Update email status
        email.status = 'Sent';
        email.sentAt = new Date();
        email.threadId = threadId;
        email.messageId = response.data.id;
        await email.save();
        
        // Update campaign stats
        campaign.sentCount += 1;
        await campaign.save();
        
        // Record successful send in Lead
        const lead = await Lead.findOne({ 
          campaignId: campaign._id,
          email: email.to
        });
        
        if (lead) {
          lead.lastActivity = new Date();
          await lead.save();
        }
        
        console.log(`Email sent successfully to ${email.to}`);
        
        // Rate limiting - respect Gmail API limits
        await new Promise(resolve => setTimeout(resolve, campaign.settings.sendInterval * 1000));
        
      } catch (error) {
        console.error(`Error sending email ${email._id}:`, error);
        
        // Update email with error
        email.status = 'Failed';
        email.error = error.message;
        await email.save();
      }
    }
    
  } catch (error) {
    console.error('Error processing email queue:', error);
  }
}

// async function scheduleFollowUps() {
//   try {
//     const activeCampaigns = await Campaign.find({ status: 'Active' });
    
//     for (const campaign of activeCampaigns) {
//       const leads = await Lead.find({ campaignId: campaign._id, status: 'Active' });
//       const sentEmails = await EmailQueue.find({ campaignId: campaign._id, status: 'Sent' });
      
//       const emailsByRecipient = sentEmails.reduce((acc, email) => {
//         if (!acc[email.to]) acc[email.to] = [];
//         acc[email.to].push(email);
//         return acc;
//       }, {});
      
//       for (const lead of leads) {
//         if (campaign.settings.stopOnReply && lead.replies.length > 0) continue;
//         if (campaign.settings.stopOnClick && lead.clicks.length > 0) continue;
        
//         const leadEmails = emailsByRecipient[lead.email] || [];
//         const lastEmail = leadEmails.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
        
//         if (!lastEmail) continue;

//         if (campaign.settings.stopOnReply && await checkForReplies(lastEmail)) {
//           lead.replies.push({ date: new Date(), emailId: lastEmail._id });
//           await lead.save();
//           continue;
//         }
        
        
//         const followUpIndex = lastEmail.type === 'Initial' ? 0 : (lastEmail.followUpIndex + 1);
//         const followUp = campaign.followUpEmails[followUpIndex];
        
//         if (!followUp) continue;
        
//         const existingFollowUp = await EmailQueue.findOne({
//           campaignId: campaign._id,
//           to: lead.email,
//           type: 'FollowUp',
//           followUpIndex
//         });
        
//         if (existingFollowUp) continue;
        
//         const delayMillis = {
//           minutes: followUp.waitDuration * 60 * 1000,
//           hours: followUp.waitDuration * 60 * 60 * 1000,
//           days: followUp.waitDuration * 24 * 60 * 60 * 1000,
//           weeks: followUp.waitDuration * 7 * 24 * 60 * 60 * 1000
//         }[followUp.waitUnit.toLowerCase()] || (followUp.waitDuration * 24 * 60 * 60 * 1000);
        
//         const scheduledFor = new Date(lastEmail.sentAt.getTime() + delayMillis);
        
//         await EmailQueue.create({
//           campaignId: campaign._id,
//           to: lead.email,
//           subject: followUp.subject,
//           body: followUp.body,
//           scheduledFor,
//           status: 'Pending',
//           type: 'FollowUp',
//           followUpIndex,
//           metadata: { leadId: lead._id, followUpNumber: followUpIndex + 1 }
//         });
        
//         console.log(`Scheduled follow-up #${followUpIndex + 1} to ${lead.email} for ${scheduledFor}`);
//       }
//     }
//   } catch (error) {
//     console.error('Error scheduling follow-ups:', error);
//   }
// }

// Start queue processing


async function scheduleFollowUps() {
  try {
    const activeCampaigns = await Campaign.find({ status: 'Active' });
    
    for (const campaign of activeCampaigns) {
      const leads = await Lead.find({ campaignId: campaign._id, status: 'Active' });
      const sentEmails = await EmailQueue.find({ campaignId: campaign._id, status: 'Sent' });
      
      const emailsByRecipient = sentEmails.reduce((acc, email) => {
        if (!acc[email.to]) acc[email.to] = [];
        acc[email.to].push(email);
        return acc;
      }, {});
      
      for (const lead of leads) {
        if (campaign.settings.stopOnReply && lead.replies.length > 0) continue;
        if (campaign.settings.stopOnClick && lead.clicks.length > 0) continue;
        
        const leadEmails = emailsByRecipient[lead.email] || [];
        const lastEmail = leadEmails.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
        
        if (!lastEmail) continue;

        if (campaign.settings.stopOnReply && await checkForReplies(lastEmail)) {
          lead.replies.push({ date: new Date(), emailId: lastEmail._id });
          await lead.save();
          continue;
        }
        
        const followUpIndex = lastEmail.type === 'Initial' ? 0 : (lastEmail.followUpIndex + 1);
        const followUp = campaign.followUpEmails[followUpIndex];
        
        if (!followUp) continue;
        
        const existingFollowUp = await EmailQueue.findOne({
          campaignId: campaign._id,
          to: lead.email,
          type: 'FollowUp',
          followUpIndex
        });
        
        if (existingFollowUp) continue;
        
        const delayMillis = {
          minutes: followUp.waitDuration * 60 * 1000,
          hours: followUp.waitDuration * 60 * 60 * 1000,
          days: followUp.waitDuration * 24 * 60 * 60 * 1000,
          weeks: followUp.waitDuration * 7 * 24 * 60 * 60 * 1000
        }[followUp.waitUnit.toLowerCase()] || (followUp.waitDuration * 24 * 60 * 60 * 1000);
        
        const scheduledFor = new Date(lastEmail.sentAt.getTime() + delayMillis);
        
        // Ensure the follow-up body is properly formatted HTML
        const emailBody = ensureHTMLFormatting(followUp.body, lead);
        
        await EmailQueue.create({
          campaignId: campaign._id,
          to: lead.email,
          subject: followUp.subject,
          body: emailBody,
          scheduledFor,
          status: 'Pending',
          type: 'FollowUp',
          followUpIndex,
          metadata: { leadId: lead._id, followUpNumber: followUpIndex + 1 }
        });
        
        console.log(`Scheduled follow-up #${followUpIndex + 1} to ${lead.email} for ${scheduledFor}`);
      }
    }
  } catch (error) {
    console.error('Error scheduling follow-ups:', error);
  }
}

/**
 * Ensures the email body is properly formatted HTML and personalizes it for the lead
 * @param {string} body - The email body content
 * @param {Object} lead - The lead object with personalization data
 * @returns {string} - Properly formatted HTML email body
 */
function ensureHTMLFormatting(body, lead) {
  // First, make sure it's HTML formatted with proper paragraph tags
  let formattedBody = createFormattedHTML(body);
  
  // Then, personalize the content for the lead
  formattedBody = personalizeEmailContent(formattedBody, lead);
  
  return formattedBody;
}

/**
 * Converts plain text to properly formatted HTML if needed
 * @param {string} text - The text to format
 * @returns {string} - HTML formatted text
 */
function createFormattedHTML(text) {
  // Check if text is already HTML (contains HTML tags)
  if (text.includes('<p>') || text.includes('<div>') || text.includes('<br>')) {
    return text;
  }
  
  // Otherwise, format plain text with proper HTML
  return text.split('\n\n')
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Personalizes email content by replacing placeholders with lead data
 * @param {string} content - The email content with placeholders
 * @param {Object} lead - The lead object with personalization data
 * @returns {string} - Personalized email content
 */
function personalizeEmailContent(content, lead) {
  // Replace placeholders with lead data
  return content
    .replace(/{first_name}/g, lead.firstName || '')
    .replace(/{last_name}/g, lead.lastName || '')
    .replace(/{email}/g, lead.email || '')
    .replace(/{company}/g, lead.company || '')
    .replace(/{title}/g, lead.title || '')
    .replace(/{industry}/g, lead.industry || '')
    .replace(/{city}/g, lead.city || '')
    .replace(/{state}/g, lead.state || '')
    .replace(/{website}/g, lead.website || '');
}


function startQueueProcessing() {
  setInterval(processEmailQueue, 60 * 1000);
  setInterval(scheduleFollowUps, 15 * 60 * 1000);
  console.log('Email queue processing started');
}

module.exports = {
  processEmailQueue,
  scheduleFollowUps,
  startQueueProcessing
};