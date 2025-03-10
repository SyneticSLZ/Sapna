
// app.js - Main application file
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth-routes');
const campaignRoutes = require('./routes/campaign-routes');
const trackingRoutes = require('./routes/tracking-routes');
const gmailRoutes = require('./routes/gmail-routes');
const dataRoutes = require('./routes/data-routes')
const emailVerificationRoutes = require('./routes/email-verification-routes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// mongoose.set('strictQuery', false);
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(helmet()); // Security headers
app.use(morgan('dev')); // Logging
app.use(express.json({ limit: '50mb' })); // JSON body parser with larger limit
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Form data parser

// CORS configuration
// Development-only CORS configuration
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: true, // Allow any origin in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
} else {
  // Production CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
}

// Session management
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGODB_URI,
    ttl: 14 * 24 * 60 * 60 // 14 days
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', campaignRoutes);
app.use('/api', trackingRoutes);
app.use('/api', gmailRoutes);
app.use('/api', dataRoutes)
app.use('/api', emailVerificationRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
