// gmail-routes.js - Gmail API integration routes
const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { auth } = require('../auth');
const { User } = require('../models/user');
const crypto = require('crypto');
require('dotenv').config();

// OAuth2 client setup
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

// Scopes for Gmail API
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.settings.basic'
];

// Generate OAuth2 URL for Gmail authorization
router.get('/gmail/auth', auth, (req, res) => {
  const state = crypto.randomBytes(20).toString('hex');
  
  // Store state in session to verify callback
  req.session.oauthState = state;
  
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Always get refresh token
    state: JSON.stringify({
      userId: req.user._id,
      state: state
    })
  });
  
  res.json({ url: authUrl });
});

router.get('/gmail/accounts/:email/signature', auth, async (req, res) => {
  const { email } = req.params;

  try {
    // Find token for this email
    const token = req.user.tokens.find(t => t.email === email && t.provider === 'gmail');
    if (!token) {
      return res.status(404).json({ error: 'Gmail account not found' });
    }

    // Set up credentials
    oAuth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiry?.getTime()
    });

    // Refresh token if expired
    if (token.expiry < new Date()) {
      const { credentials } = await oAuth2Client.refreshAccessToken();
      token.accessToken = credentials.access_token;
      if (credentials.refresh_token) {
        token.refreshToken = credentials.refresh_token;
      }
      token.expiry = new Date(credentials.expiry_date);
      await req.user.save();
      oAuth2Client.setCredentials(credentials);
    }

    // Initialize Gmail API
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Get send-as settings which includes the signature
    const response = await gmail.users.settings.sendAs.list({
      userId: 'me'
    });

    // Find the send-as configuration for the specified email
    const sendAsConfig = response.data.sendAs.find(config => config.sendAsEmail === email);
    if (!sendAsConfig) {
      return res.status(404).json({ error: 'Send-as configuration not found for this email' });
    }

    // Return the signature
    res.json({ 
      signature: sendAsConfig.signature || '' // Return empty string if no signature
    });
  } catch (error) {
    console.error('Error fetching Gmail signature:', error);
    res.status(500).json({ 
      error: 'Failed to fetch signature',
      message: error.message 
    });
  }
});


// Handle OAuth2 callback
router.get('/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  
  try {
    // Parse state
    const stateObj = JSON.parse(state);
    const { userId } = stateObj;
    
    // Exchange code for tokens
    const { tokens } = await oAuth2Client.getToken(code);
    
    // Set credentials to get user info
    oAuth2Client.setCredentials(tokens);
    
    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();
    const gmailEmail = userInfo.data.email;
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if this Gmail account is already connected
    const existingToken = user.tokens.find(t => t.email === gmailEmail && t.provider === 'gmail');
    
    if (existingToken) {
      // Update existing token
      existingToken.accessToken = tokens.access_token;
      existingToken.refreshToken = tokens.refresh_token || existingToken.refreshToken;
      existingToken.expiry = new Date(tokens.expiry_date);
    } else {
      // Add new token
      user.tokens.push({
        provider: 'gmail',
        email: gmailEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiry: new Date(tokens.expiry_date)
      });
    }
    
    await user.save();
    
    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Connected</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
          }
          .success-container {
            max-width: 500px;
            margin: 0 auto;
            background-color: #f5f5f5;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .success-icon {
            color: #4CAF50;
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
          }
          .email {
            font-weight: bold;
            margin: 20px 0;
          }
          .btn {
            background-color: #4285F4;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <div class="success-container">
          <div class="success-icon">✓</div>
          <h1>Gmail Connected Successfully</h1>
          <p>Your Gmail account has been successfully connected.</p>
          <p class="email">${gmailEmail}</p>
          <p>You can now close this window and return to the application.</p>
          <button class="btn" onclick="window.close()">Close Window</button>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Failed</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
          }
          .error-container {
            max-width: 500px;
            margin: 0 auto;
            background-color: #f5f5f5;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .error-icon {
            color: #F44336;
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
          }
          .btn {
            background-color: #4285F4;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
          }
          .error-details {
            margin-top: 20px;
            color: #F44336;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <div class="error-icon">✗</div>
          <h1>Connection Failed</h1>
          <p>There was an error connecting your Gmail account.</p>
          <p>Please try again or contact support.</p>
          <button class="btn" onclick="window.close()">Close Window</button>
          <div class="error-details">${error.message}</div>
        </div>
      </body>
      </html>
    `);
  }
});

// List connected Gmail accounts
router.get('/gmail/accounts', auth, async (req, res) => {
  try {
    // Filter just Gmail accounts
    const gmailAccounts = req.user.tokens
      .filter(token => token.provider === 'gmail')
      .map(token => ({
        email: token.email,
        connected: new Date(token.expiry) > new Date() // Check if token is still valid
      }));
    
    res.json({ accounts: gmailAccounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test Gmail connection
router.post('/gmail/test', auth, async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    // Find token for this email
    const token = req.user.tokens.find(t => t.email === email && t.provider === 'gmail');
    
    if (!token) {
      return res.status(404).json({ error: 'Gmail account not found' });
    }
    
    // Set up credentials
    oAuth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiry?.getTime()
    });
    
    // Check if token is expired and refresh if needed
    if (token.expiry < new Date()) {
      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        
        // Update token in database
        token.accessToken = credentials.access_token;
        if (credentials.refresh_token) {
          token.refreshToken = credentials.refresh_token;
        }
        token.expiry = new Date(credentials.expiry_date);
        await req.user.save();
        
        // Update client credentials
        oAuth2Client.setCredentials(credentials);
      } catch (refreshError) {
        return res.status(401).json({ 
          error: 'Authentication expired',
          message: 'Your Gmail authentication has expired. Please reconnect your account.'
        });
      }
    }
    
    // Test connection by getting profile
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    res.json({
      success: true,
      email: profile.data.emailAddress,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal
    });
  } catch (error) {
    console.error('Error testing Gmail connection:', error);
    res.status(500).json({ 
      error: 'Failed to connect to Gmail',
      message: error.message
    });
  }
});

// Remove Gmail account
router.delete('/gmail/accounts/:email', auth, async (req, res) => {
  const { email } = req.params;
  
  try {
    // Remove token for this email
    req.user.tokens = req.user.tokens.filter(
      t => !(t.email === email && t.provider === 'gmail')
    );
    
    await req.user.save();
    
    res.json({ 
      success: true,
      message: 'Gmail account removed successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;