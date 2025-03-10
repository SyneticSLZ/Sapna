// auth.js - User authentication module
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

// Schema for user accounts
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: String,
  lastName: String,
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date,
  // Store tokens securely in the database
  tokens: [{
    provider: String, // e.g., 'gmail'
    email: String,
    accessToken: String,
    refreshToken: String,
    expiry: Date
  }]
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

// Method to check password
userSchema.methods.checkPassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Method to generate JWT token
userSchema.methods.generateAuthToken = function() {
  const token = jwt.sign(
    { _id: this._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  return token;
};

// Static method to find user by token
userSchema.statics.findByToken = async function(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return this.findOne({ _id: decoded._id });
  } catch (error) {
    throw new Error('Invalid token');
  }
};

const User = mongoose.model('User', userSchema);

// Middleware to authenticate requests
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const user = await User.findByToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }
    
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

module.exports = { User };