const cron = require('node-cron');
const { processEmailQueue, scheduleFollowUps } = require('./queue');
const mongoose = require('mongoose');
const { Campaign, EmailQueue } = require('./models');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB for cron jobs'))
.catch(err => console.error('MongoDB connection error in cron jobs:', err));

// Schedule tasks
function scheduleTasks() {
  // Process email queue every minute
  cron.schedule('* * * * *', async () => {
    console.log('Running email queue processing...');
    try {
      await processEmailQueue();
    } catch (error) {
      console.error('Error in email queue cron job:', error);
    }
  });
  
  // Schedule follow-ups every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    console.log('Scheduling follow-up emails...');
    try {
      await scheduleFollowUps();
    } catch (error) {
      console.error('Error in follow-up scheduling cron job:', error);
    }
  });
  
  // Clean up old data daily at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('Cleaning up old data...');
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Archive completed campaigns older than 30 days
      const oldCampaigns = await Campaign.find({
        status: 'Completed',
        createdAt: { $lt: thirtyDaysAgo }
      });
      
      for (const campaign of oldCampaigns) {
        // Archive campaign (in a real app, you would move to an archive collection)
        campaign.status = 'Archived';
        await campaign.save();
        
        console.log(`Archived campaign ${campaign._id}`);
      }
      
      // Delete failed emails older than 30 days
      await EmailQueue.deleteMany({
        status: 'Failed',
        createdAt: { $lt: thirtyDaysAgo }
      });
      
    } catch (error) {
      console.error('Error in cleanup cron job:', error);
    }
  });
  
  console.log('Cron tasks scheduled');
}

module.exports = { scheduleTasks };