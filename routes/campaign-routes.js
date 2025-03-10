
// // campaign-routes.js - Campaign management endpoints
const express = require('express');
const router = express.Router();
const { auth } = require('../auth');
const { Campaign, EmailQueue, Lead, AnalyticsEvent } = require('../models');
const { startQueueProcessing } = require('../queue');

// Middleware for campaign ownership check
const checkCampaignOwnership = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to access this campaign' });
    }
    req.campaign = campaign;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

router.get('/campaigns', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { userId: req.user._id };
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'page' && key !== 'limit' && value !== 'all') {
        query[key] = value;
      }
    }

    const total = await Campaign.countDocuments(query);
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('name status leadCount sentCount createdAt followUpEmails'); // Include followUpEmails

    res.json({
      success: true,
      campaigns,
      total,
      page,
      limit
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all campaigns for user with pagination
// router.get('/campaigns', auth, async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     const query = { userId: req.user._id };
//     // Add any filters from query params if needed
//     for (const [key, value] of Object.entries(req.query)) {
//       if (key !== 'page' && key !== 'limit' && value !== 'all') {
//         query[key] = value;
//       }
//     }

//     const total = await Campaign.countDocuments(query);
//     const campaigns = await Campaign.find(query)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);

//     res.json({
//       success: true,
//       campaigns,
//       total,
//       page,
//       limit
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// Get single campaign with detailed stats
// Get single campaign with detailed stats
router.get('/campaigns/:id', auth, checkCampaignOwnership, async (req, res) => {
  try {
    const emailStats = await EmailQueue.aggregate([
      { $match: { campaignId: req.campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const leadStats = await Lead.aggregate([
      { $match: { campaignId: req.campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Add leads query
    const leads = await Lead.find({ campaignId: req.campaign._id })
      .select('email firstName lastName company title website industry revenue employees city state status metadata')
      .lean();

    const analytics = {
      openCount: await AnalyticsEvent.countDocuments({ 
        campaignId: req.campaign._id,
        eventType: 'Open'
      }),
      clickCount: await AnalyticsEvent.countDocuments({ 
        campaignId: req.campaign._id,
        eventType: 'Click'
      }),
      replyCount: await AnalyticsEvent.countDocuments({ 
        campaignId: req.campaign._id,
        eventType: 'Reply'
      })
    };

    res.json({
      success: true,
      campaign: req.campaign,
      emailStats: Object.fromEntries(emailStats.map(stat => [stat._id, stat.count])),
      leadStats: Object.fromEntries(leadStats.map(stat => [stat._id, stat.count])),
      leads: leads, // Add leads to response
      analytics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new campaign
router.post('/campaigns', auth, async (req, res) => {
  try {
    const {
      campaignName,
      sendingAccount,
      startDate,
      sendSpeed,
      trackOpens,
      trackClicks,
      emailSubject,
      emailBody,
      followUpEmails
    } = req.body;
    console.log(req.body)

    if (!campaignName || !sendingAccount || !emailSubject || !emailBody) {
      return res.status(400).json({ 
        error: `Missing required fields: campaignName: ${campaignName}, sendingAccount: ${sendingAccount}, emailSubject: ${emailSubject}, emailBody: ${emailBody}`
      });
    }

    const campaign = new Campaign({
      userId: req.user._id,
      name: campaignName,
      mailboxId: sendingAccount,
      startDate: startDate || new Date(),
      status: 'Draft',
      settings: {
        sendInterval: 60,
        sendSpeed: sendSpeed || 'medium',
        trackOpens: trackOpens || false,
        trackClicks: trackClicks || false
      },
      initialEmail: {
        subject: emailSubject,
        body: emailBody
      },
      followUpEmails: followUpEmails || []
    });

    await campaign.save();

    res.json({
      success: true,
      message: 'Campaign created successfully',
      campaignId: campaign._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload leads to campaign
router.post('/campaigns/:id/leads', auth, checkCampaignOwnership, async (req, res) => {
  try {
    const { leads } = req.body;
    console.log(req.body)

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'No leads provided' });
    }

    const leadObjects = leads.map(lead => ({
      campaignId: req.campaign._id,
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      title: lead.title,
      website: lead.website,
      industry: lead.industry,
      revenue: lead.revenue,
      employees: lead.employees,
      city: lead.city,
      state: lead.state,
      status: 'Active',
      metadata: lead.metadata || {}
    }));

    const result = await Lead.insertMany(leadObjects);
    req.campaign.leadCount = await Lead.countDocuments({ campaignId: req.campaign._id });
    await req.campaign.save();

    res.json({
      success: true,
      message: `${result.length} leads added to campaign`,
      leadCount: req.campaign.leadCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start campaign
// router.post('/campaigns/:id/start', auth, checkCampaignOwnership, async (req, res) => {
//   console.log(req.body)
//   try {

//     const leadCount = await Lead.countDocuments({ campaignId: req.campaign._id });
//     if (leadCount === 0) {
//       return res.status(400).json({ error: 'Campaign has no leads to send to' });
//     }

//     const leads = await Lead.find({ campaignId: req.campaign._id });
//     const now = new Date();
//     const startDate = req.campaign.startDate > now ? req.campaign.startDate : now;
//     const sendInterval = req.campaign.settings.sendInterval || 60;

//     const emails = leads.map((lead, index) => {
//       const scheduledFor = new Date(startDate.getTime() + (index * sendInterval * 1000));
//       let subject = req.campaign.initialEmail.subject;
//       let body = req.campaign.initialEmail.body;

//       const replacements = {
//         '{first_name}': lead.firstName || '',
//         '{last_name}': lead.lastName || '',
//         '{company}': lead.company || '',
//         '{title}': lead.title || '',
//         '{city}': lead.city || '',
//         '{state}': lead.state || '',
//         '{industry}': lead.industry || '',
//         '{email}': lead.email || ''
//       };

//       Object.entries(replacements).forEach(([key, value]) => {
//         subject = subject.replace(new RegExp(key, 'g'), value);
//         body = body.replace(new RegExp(key, 'g'), value);
//       });

//       return {
//         campaignId: req.campaign._id,
//         to: lead.email,
//         subject,
//         body,
//         scheduledFor,
//         status: 'Pending',
//         type: 'Initial',
//         metadata: { leadId: lead._id }
//       };
//     });

//     await EmailQueue.insertMany(emails);
//     req.campaign.status = 'Active';
//     await req.campaign.save();

//     res.json({
//       success: true,
//       message: `Campaign started with ${emails.length} emails scheduled`,
//       firstSendAt: emails[0]?.scheduledFor
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

router.post('/campaigns/:id/start', auth, checkCampaignOwnership, async (req, res) => {
  try {
    const leadCount = await Lead.countDocuments({ campaignId: req.campaign._id });
    if (leadCount === 0) {
      return res.status(400).json({ error: 'Campaign has no leads to send to' });
    }

    const leads = await Lead.find({ campaignId: req.campaign._id });
    const now = new Date();
    const startDate = req.campaign.startDate > now ? req.campaign.startDate : now;
    const sendInterval = req.campaign.settings.sendInterval || 60;

    // Queue initial emails
    const initialEmails = leads.map((lead, index) => {
      const scheduledFor = new Date(startDate.getTime() + (index * sendInterval * 1000));
      let subject = req.campaign.initialEmail.subject;
      let body = req.campaign.initialEmail.body;

      const replacements = {
        '{first_name}': lead.firstName || '',
        '{last_name}': lead.lastName || '',
        '{company}': lead.company || '',
        '{title}': lead.title || '',
        '{city}': lead.city || '',
        '{state}': lead.state || '',
        '{industry}': lead.industry || '',
        '{email}': lead.email || ''
      };

      Object.entries(replacements).forEach(([key, value]) => {
        subject = subject.replace(new RegExp(key, 'g'), value);
        body = body.replace(new RegExp(key, 'g'), value);
      });

      return {
        campaignId: req.campaign._id,
        to: lead.email,
        subject,
        body,
        scheduledFor,
        status: 'Pending',
        type: 'Initial',
        metadata: { leadId: lead._id }
      };
    });

    await EmailQueue.insertMany(initialEmails);

    // Queue follow-up emails
    const followUpEmails = req.campaign.followUpEmails || [];
    for (const [followUpIndex, followUp] of followUpEmails.entries()) {
      const waitMs = calculateWaitMs(followUp.waitDuration, followUp.waitUnit);
      leads.forEach((lead, leadIndex) => {
        const initialScheduledFor = initialEmails[leadIndex].scheduledFor;
        const followUpScheduledFor = new Date(initialScheduledFor.getTime() + waitMs);

        let subject = followUp.subject;
        let body = followUp.body;

        const replacements = {
          '{first_name}': lead.firstName || '',
          '{last_name}': lead.lastName || '',
          '{company}': lead.company || '',
          '{title}': lead.title || '',
          '{city}': lead.city || '',
          '{state}': lead.state || '',
          '{industry}': lead.industry || '',
          '{email}': lead.email || ''
        };

        Object.entries(replacements).forEach(([key, value]) => {
          subject = subject.replace(new RegExp(key, 'g'), value);
          body = body.replace(new RegExp(key, 'g'), value);
        });

        EmailQueue.create({
          campaignId: req.campaign._id,
          to: lead.email,
          subject,
          body,
          scheduledFor: followUpScheduledFor,
          status: 'Pending',
          type: 'FollowUp',
          metadata: { leadId: lead._id, followUpIndex }
        });
      });
    }

    req.campaign.status = 'Active';
    await req.campaign.save();

    res.json({
      success: true,
      message: `Campaign started with ${initialEmails.length} initial emails and ${followUpEmails.length} follow-up sequences scheduled`,
      firstSendAt: initialEmails[0]?.scheduledFor
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to calculate wait time in milliseconds
function calculateWaitMs (duration, unit) {
  switch (unit.toLowerCase()) {
    case 'minutes':
      return duration * 60 * 1000;
    case 'hours':
      return duration * 60 * 60 * 1000;
    case 'days':
      return duration * 24 * 60 * 60 * 1000;
    case 'weeks':
      return duration * 7 * 24 * 60 * 60 * 1000;
    default:
      return duration * 60 * 60 * 1000; // Default to hours
  }
}

// Pause campaign
router.post('/campaigns/:id/pause', auth, checkCampaignOwnership, async (req, res) => {
  console.log(req.body)
  try {
    req.campaign.status = 'Paused';
    await req.campaign.save();

    await EmailQueue.updateMany(
      { campaignId: req.campaign._id, status: 'Pending' },
      { $set: { status: 'Paused' } }
    );

    res.json({
      success: true,
      message: 'Campaign paused successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resume campaign
router.post('/campaigns/:id/resume', auth, checkCampaignOwnership, async (req, res) => {
  console.log(req.body)
  try {
    req.campaign.status = 'Active';
    await req.campaign.save();

    await EmailQueue.updateMany(
      { campaignId: req.campaign._id, status: 'Paused' },
      { $set: { status: 'Pending' } }
    );

    res.json({
      success: true,
      message: 'Campaign resumed successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete campaign
router.delete('/campaigns/:id', auth, checkCampaignOwnership, async (req, res) => {
  console.log(req.body)
  try {
    await Campaign.deleteOne({ _id: req.campaign._id });
    await EmailQueue.deleteMany({ campaignId: req.campaign._id });
    await Lead.deleteMany({ campaignId: req.campaign._id });
    await AnalyticsEvent.deleteMany({ campaignId: req.campaign._id });

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize processing
startQueueProcessing();

module.exports = router;
// const express = require('express');
// const router = express.Router();
// const { auth } = require('../auth');
// const { Campaign, EmailQueue, Lead, AnalyticsEvent } = require('../models');
// const { startQueueProcessing } = require('../queue');

// // Middleware for campaign ownership check
// const checkCampaignOwnership = async (req, res, next) => {
//   try {
//     const campaign = await Campaign.findById(req.params.id);
    
//     if (!campaign) {
//       return res.status(404).json({ error: 'Campaign not found' });
//     }
    
//     if (campaign.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ error: 'Not authorized to access this campaign' });
//     }
    
//     req.campaign = campaign;
//     next();
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// };

// // Get all campaigns for user
// router.get('/campaigns', auth, async (req, res) => {
//   try {
//     const campaigns = await Campaign.find({ userId: req.user._id })
//       .sort({ createdAt: -1 });
    
//     res.json({ success: true, campaigns });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Get single campaign with detailed stats
// router.get('/campaigns/:id', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     // Get email stats
//     const emailStats = await EmailQueue.aggregate([
//       { $match: { campaignId: req.campaign._id } },
//       { $group: {
//         _id: '$status',
//         count: { $sum: 1 }
//       }}
//     ]);
    
//     // Get lead stats
//     const leadStats = await Lead.aggregate([
//       { $match: { campaignId: req.campaign._id } },
//       { $group: {
//         _id: '$status',
//         count: { $sum: 1 }
//       }}
//     ]);
    
//     // Get analytics
//     const analytics = {
//       openCount: await AnalyticsEvent.countDocuments({ 
//         campaignId: req.campaign._id,
//         eventType: 'Open'
//       }),
//       clickCount: await AnalyticsEvent.countDocuments({ 
//         campaignId: req.campaign._id,
//         eventType: 'Click'
//       }),
//       replyCount: await AnalyticsEvent.countDocuments({ 
//         campaignId: req.campaign._id,
//         eventType: 'Reply'
//       })
//     };
    
//     res.json({
//       success: true,
//       campaign: req.campaign,
//       emailStats: Object.fromEntries(emailStats.map(stat => [stat._id, stat.count])),
//       leadStats: Object.fromEntries(leadStats.map(stat => [stat._id, stat.count])),
//       analytics
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Create new campaign
// router.post('/campaigns', auth, async (req, res) => {
//   try {
//     const {
//       campaignName,           // Changed from 'name'
//       sendingAccount,        // Changed from 'mailboxId'
//       startDate,
//       sendSpeed,             // Added to settings
//       trackOpens,           // Added to settings
//       trackClicks,          // Added to settings
//       emailSubject,         // Changed from initialEmail.subject
//       emailBody,           // Changed from initialEmail.body
//       followUpEmails
//     } = req.body;

//     console.log(req.body)
    
//     // Validate required fields
//     if (!campaignName || !sendingAccount || !emailSubject || !emailBody) {
//       return res.status(400).json({ 
//         error: `Missing required campaign fields: campaignName: ${campaignName}, sendingAccount: ${sendingAccount}, emailSubject: ${emailSubject}, emailBody: ${emailBody}`
//       });
//     }
    
//     // Create campaign
//     const campaign = new Campaign({
//       userId: req.user._id,
//       name: campaignName,                    // Map to schema field
//       mailboxId: sendingAccount,            // Map to schema field
//       startDate: startDate || new Date(),
//       status: 'Draft',
//       settings: {
//         sendInterval: 60,                   // Default value
//         sendSpeed: sendSpeed || 'medium',   // Added from input
//         trackOpens: trackOpens || false,    // Added from input
//         trackClicks: trackClicks || false   // Added from input
//       },
//       initialEmail: {                      // Construct object
//         subject: emailSubject,
//         body: emailBody
//       },
//       followUpEmails: followUpEmails || []
//     });
    
//     await campaign.save();
    
//     res.json({
//       success: true,
//       message: 'Campaign created successfully',
//       campaignId: campaign._id
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Upload leads to campaign
// router.post('/campaigns/:id/leads', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     const leads = req.body.leads;
    
//     if (!Array.isArray(leads) || leads.length === 0) {
//       return res.status(400).json({ error: 'No leads provided' });
//     }
    
//     // Create lead objects
//     const leadObjects = leads.map(lead => ({
//       campaignId: req.campaign._id,
//       email: lead.email,
//       firstName: lead.firstName || lead.first_name,
//       lastName: lead.lastName || lead.last_name,
//       company: lead.company,
//       title: lead.title || lead.job_title,
//       website: lead.website,
//       industry: lead.industry,
//       revenue: lead.revenue,
//       employees: lead.employees,
//       city: lead.city,
//       state: lead.state,
//       status: 'Active',
//       metadata: lead.metadata || {}
//     }));
    
//     // Insert leads
//     const result = await Lead.insertMany(leadObjects);
    
//     // Update campaign lead count
//     req.campaign.leadCount = await Lead.countDocuments({ campaignId: req.campaign._id });
//     await req.campaign.save();
    
//     res.json({
//       success: true,
//       message: `${result.length} leads added to campaign`,
//       leadCount: req.campaign.leadCount
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Start campaign
// router.post('/campaigns/:id/start', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     // Check if campaign has leads
//     const leadCount = await Lead.countDocuments({ campaignId: req.campaign._id });
    
//     if (leadCount === 0) {
//       return res.status(400).json({ error: 'Campaign has no leads to send to' });
//     }
    
//     // Schedule initial emails for all leads
//     const leads = await Lead.find({ campaignId: req.campaign._id });
    
//     // Calculate send dates with staggering
//     const now = new Date();
//     const startDate = req.campaign.startDate > now ? req.campaign.startDate : now;
//     const sendInterval = req.campaign.settings.sendInterval || 60; // seconds
    
//     const emails = [];
    
//     leads.forEach((lead, index) => {
//       // Stagger send times
//       const scheduledFor = new Date(startDate.getTime() + (index * sendInterval * 1000));
      
//       // Personalize email content
//       let subject = req.campaign.initialEmail.subject;
//       let body = req.campaign.initialEmail.body;
      
//       // Simple template variable replacement
//       const replacements = {
//         '{first_name}': lead.firstName || '',
//         '{last_name}': lead.lastName || '',
//         '{company}': lead.company || '',
//         '{title}': lead.title || '',
//         '{city}': lead.city || '',
//         '{state}': lead.state || '',
//         '{industry}': lead.industry || '',
//         '{email}': lead.email || ''
//       };
      
//       Object.entries(replacements).forEach(([key, value]) => {
//         subject = subject.replace(new RegExp(key, 'g'), value);
//         body = body.replace(new RegExp(key, 'g'), value);
//       });
      
//       emails.push({
//         campaignId: req.campaign._id,
//         to: lead.email,
//         subject,
//         body,
//         scheduledFor,
//         status: 'Pending',
//         type: 'Initial',
//         metadata: {
//           leadId: lead._id
//         }
//       });
//     });
    
//     // Insert emails into queue
//     await EmailQueue.insertMany(emails);
    
//     // Update campaign status
//     req.campaign.status = 'Active';
//     await req.campaign.save();
    
//     res.json({
//       success: true,
//       message: `Campaign started with ${emails.length} emails scheduled`,
//       firstSendAt: emails[0]?.scheduledFor
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Pause campaign
// router.post('/campaigns/:id/pause', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     // Update campaign status
//     req.campaign.status = 'Paused';
//     await req.campaign.save();
    
//     // Mark pending emails as paused (requires adding a 'Paused' status to the EmailQueue model)
//     await EmailQueue.updateMany(
//       { 
//         campaignId: req.campaign._id,
//         status: 'Pending'
//       },
//       { 
//         $set: { status: 'Paused' }
//       }
//     );
    
//     res.json({
//       success: true,
//       message: 'Campaign paused successfully'
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Resume campaign
// router.post('/campaigns/:id/resume', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     // Update campaign status
//     req.campaign.status = 'Active';
//     await req.campaign.save();
    
//     // Resume paused emails
//     await EmailQueue.updateMany(
//       { 
//         campaignId: req.campaign._id,
//         status: 'Paused'
//       },
//       { 
//         $set: { status: 'Pending' }
//       }
//     );
    
//     res.json({
//       success: true,
//       message: 'Campaign resumed successfully'
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Delete campaign
// router.delete('/campaigns/:id', auth, checkCampaignOwnership, async (req, res) => {
//   try {
//     // Delete campaign and related data
//     await Campaign.deleteOne({ _id: req.campaign._id });
//     await EmailQueue.deleteMany({ campaignId: req.campaign._id });
//     await Lead.deleteMany({ campaignId: req.campaign._id });
//     await AnalyticsEvent.deleteMany({ campaignId: req.campaign._id });
    
//     res.json({
//       success: true,
//       message: 'Campaign deleted successfully'
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Initialize processing
// startQueueProcessing();

// module.exports = router;