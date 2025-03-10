// routes/auth-routes.js - Authentication routes
const express = require('express');
const router = express.Router();
const { User } = require('../models/user');
const { auth } = require('../auth');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    
    // Create new user
    const user = new User({
      email,
      password, // Will be hashed via pre-save hook
      firstName,
      lastName,
      verificationToken: crypto.randomBytes(32).toString('hex')
    });
    
    await user.save();
    
    // Generate authentication token
    const token = user.generateAuthToken();
    
    // Send verification email
    sendVerificationEmail(user.email, user.verificationToken);
    
    res.status(201).json({
      message: 'User registered successfully',
      userId: user._id,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check password
    const isMatch = await user.checkPassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check if account is verified
    if (user.verificationToken && !user.verified) {
      return res.status(401).json({ 
        error: 'Account not verified',
        message: 'Please verify your email address to log in'
      });
    }
    
    // Generate authentication token
    const token = user.generateAuthToken();
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      message: 'Login successful',
      userId: user._id,
      token,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify email
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find user with this token
    const user = await User.findOne({ verificationToken: token });
    
    if (!user) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
            <h1>Invalid Verification Link</h1>
            <p>The verification link is invalid or has expired.</p>
            <p><a href="${process.env.FRONTEND_URL}">Return to homepage</a></p>
          </body>
        </html>
      `);
    }
    
    // Mark as verified
    user.verified = true;
    user.verificationToken = undefined;
    await user.save();
    
    // Display success message instead of redirect
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
          <h1>Email Verified Successfully</h1>
          <p>Your email has been verified. You can now close this window.</p>
          <p><a href="https://voltmailer.com/Drip.html">Return to homepage</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
          <h1>Verification Failed</h1>
          <p>There was an error verifying your email. Please try again later.</p>
          <p><a href="https://voltmailer.com/Drip.html">Return to homepage</a></p>
        </body>
      </html>
    `);
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    
    // Always return success even if user not found (security)
    if (!user) {
      return res.json({ message: 'If a user with that email exists, a password reset link has been sent' });
    }
    
    // Generate reset token and expiration
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    
    await user.save();
    
    // Send reset email
    await sendPasswordResetEmail(user.email, resetToken);
    
    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset password
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    // Find user with this token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }
    
    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    
    await user.save();
    
    res.json({ message: 'Password has been updated' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get current user profile
router.get('/profile', auth, async (req, res) => {
  res.json({
    user: {
      _id: req.user._id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      createdAt: req.user.createdAt,
      lastLogin: req.user.lastLogin,
      connectedAccounts: req.user.tokens.map(t => ({
        provider: t.provider,
        email: t.email
      }))
    }
  });
});

// Update user profile
router.put('/profile', auth, async (req, res) => {
  const { firstName, lastName } = req.body;
  
  try {
    req.user.firstName = firstName || req.user.firstName;
    req.user.lastName = lastName || req.user.lastName;
    
    await req.user.save();
    
    res.json({
      message: 'Profile updated successfully',
      user: {
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Change password
router.put('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  try {
    // Verify current password
    const isMatch = await req.user.checkPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    req.user.password = newPassword;
    await req.user.save();
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to send verification email
async function sendVerificationEmail(email, token) {
  // Create a test account if no mail configuration
  let transporter;
  
  if (process.env.MAIL_HOST) {
    // Use configured mail server
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
      }
    });
  } else {
    // Use ethereal for testing
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  }
  
  const verificationUrl = `${process.env.BASE_URL}/api/auth/verify/${token}`;
  const mailOptions = {
    from: `"SyneticX" <${process.env.MAIL_FROM || 'verification@syneticx.com'}>`,
    to: email,
    subject: 'SyneticX Email Verification',
    text: `Hi,\n\nThank you for choosing SyneticX! Please verify your email address by clicking the link below:\n\n${verificationUrl}\n\nIf you did not sign up for a SyneticX account, you can ignore this email or contact us at support@syneticx.com.\n\nBest regards,\nThe SyneticX Team\n\n© 2025 SyneticX. All rights reserved.\nIf you’d prefer not to receive these emails, you can unsubscribe here: ${process.env.FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(email)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1a1a; color: #ffffff; padding: 20px; border-radius: 8px;">
        <div style="text-align: center; padding: 15px 0; background-color: #000000;">
          <h1 style="color: #9370DB; font-size: 28px; margin: 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
            SyneticX
          </h1>
        </div>
        <div style="padding: 20px;">
          <h2 style="color: #ADD8E6; font-size: 20px; margin-bottom: 15px;">Verify Your Email Address</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #d3d3d3;">Hi${user?.firstName ? ` ${user.firstName}` : ''},</p>
          <p style="font-size: 16px; line-height: 1.5; color: #d3d3d3;">Thank you for choosing SyneticX! To activate your account, please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 25px 0;">
            <a href="${verificationUrl}" style="background-color: #9370DB; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; display: inline-block;">Verify Email</a>
          </div>
          <p style="font-size: 14px; color: #d3d3d3;">Or copy and paste this link into your browser:</p>
          <p style="font-size: 14px; color: #ADD8E6; word-break: break-all;">${verificationUrl}</p>
          <p style="font-size: 14px; color: #d3d3d3;">If you did not sign up for a SyneticX account, you can ignore this email or contact our support team at <a href="mailto:support@syneticx.com" style="color: #ADD8E6; text-decoration: none;">support@syneticx.com</a>.</p>
        </div>
        <div style="text-align: center; padding: 10px; background-color: #000000; color: #d3d3d3; font-size: 12px; border-top: 1px solid #9370DB;">
          <p>© 2025 SyneticX. All rights reserved.</p>
          <p>
            <a href="${process.env.FRONTEND_URL}/terms" style="color: #ADD8E6; text-decoration: none; margin: 0 5px;">Terms</a> | 
            <a href="${process.env.FRONTEND_URL}/privacy" style="color: #ADD8E6; text-decoration: none; margin: 0 5px;">Privacy</a> | 
            <a href="${process.env.FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #ADD8E6; text-decoration: none; margin: 0 5px;">Unsubscribe</a>
          </p>
        </div>
      </div>
    `
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent:', info.messageId);
    
    // Log ethereal URL for testing
    if (!process.env.MAIL_HOST) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Error sending verification email:', error);
  }
}

// Helper function to send password reset email
async function sendPasswordResetEmail(email, token) {
  // Similar to the verification email function
  let transporter;
  
  if (process.env.MAIL_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD
      }
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  }
  
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
  
  const mailOptions = {
    from: `"Email Campaign App" <${process.env.MAIL_FROM || 'noreply@example.com'}>`,
    to: email,
    subject: 'Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>You requested a password reset. Please click the button below to reset your password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #4285F4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
        </div>
        <p>Or copy and paste this link in your browser:</p>
        <p>${resetUrl}</p>
        <p>If you did not request a password reset, you can ignore this email.</p>
        <p>This link will expire in 1 hour.</p>
      </div>
    `
  };
  
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    
    // Log ethereal URL for testing
    if (!process.env.MAIL_HOST) {
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Error sending password reset email:', error);
  }
}

module.exports = router;
