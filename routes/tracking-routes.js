// tracking-routes.js - Email tracking endpoints
const express = require('express');
const router = express.Router();
const { AnalyticsEvent, Lead, Campaign, EmailQueue } = require('../models');

// Track email opens
router.get('/track-open', async (req, res) => {
  const { cid, eid, tid } = req.query;
  
  try {
    if (cid && eid) {
      // Find the email
      const email = await EmailQueue.findById(eid);
      
      if (email) {
        // Find the lead
        const lead = await Lead.findOne({ 
          campaignId: cid,
          email: email.to
        });
        
        if (lead) {
          // Record the open
          lead.opens.push({ date: new Date() });
          lead.lastActivity = new Date();
          await lead.save();
          
          // Add analytics event
          await AnalyticsEvent.create({
            eventType: 'Open',
            campaignId: cid,
            leadId: lead._id,
            emailId: eid,
            metadata: { trackingId: tid }
          });
          
          // Update campaign stats
          const campaign = await Campaign.findById(cid);
          if (campaign) {
            campaign.openCount = (campaign.openCount || 0) + 1;
            await campaign.save();
          }
        }
      }
    }
    
    // Return a 1x1 transparent pixel
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  } catch (error) {
    console.error('Error tracking open:', error);
    res.set('Content-Type', 'image/gif');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    }
})

// Track link clicks
router.get('/track-click', async (req, res) => {
    const { cid, eid, tid, url } = req.query;
    
    try {
      if (cid && eid && url) {
        // Find the email
        const email = await EmailQueue.findById(eid);
        
        if (email) {
          // Find the lead
          const lead = await Lead.findOne({ 
            campaignId: cid,
            email: email.to
          });
          
          if (lead) {
            // Record the click
            lead.clicks.push({ 
              date: new Date(),
              url: url
            });
            lead.lastActivity = new Date();
            await lead.save();
            
            // Add analytics event
            await AnalyticsEvent.create({
              eventType: 'Click',
              campaignId: cid,
              leadId: lead._id,
              emailId: eid,
              metadata: { 
                trackingId: tid,
                url: url
              }
            });
            
            // Update campaign stats
            const campaign = await Campaign.findById(cid);
            if (campaign) {
              campaign.clickCount = (campaign.clickCount || 0) + 1;
              await campaign.save();
              
              // If campaign is configured to stop on click, update lead status
              if (campaign.settings?.stopOnClick) {
                await EmailQueue.updateMany(
                  { 
                    campaignId: cid,
                    to: lead.email,
                    status: 'Pending'
                  },
                  { 
                    $set: { status: 'Cancelled' }
                  }
                );
              }
            }
          }
        }
      }
      
      // Redirect to the original URL
      if (url) {
        return res.redirect(url);
      }
      
      // Fallback if no URL
      res.status(404).send('Link not found');
    } catch (error) {
      console.error('Error tracking click:', error);
      // Still try to redirect if possible
      if (url) {
        return res.redirect(url);
      }
      res.status(500).send('Error processing link');
    }
  });
  
  module.exports = router;