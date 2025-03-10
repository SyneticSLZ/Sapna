// routes/email-verification-routes.js - Email verification routes
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { auth } = require('../auth');
require('dotenv').config();

// Constants for external APIs
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const HUNTER_API_URL = 'https://api.hunter.io/v2';

// Verify a single email address
router.post('/verify-email', auth, async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  try {
    const response = await axios.get(`${HUNTER_API_URL}/email-verifier`, {
      params: {
        email,
        api_key: HUNTER_API_KEY
      }
    });
    
    res.json({
      success: true,
      result: response.data.data
    });
  } catch (error) {
    console.error('Email verification error:', error.response?.data || error.message);
    
    if (error.response && error.response.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please try again later.'
      });
    }
    
    res.status(500).json({
        success: false,
        error: 'Email verification failed',
        details: error.response?.data || error.message
      });
    }
  });
  
  // Verify a domain
  router.post('/verify-domain', auth, async (req, res) => {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    try {
      const response = await axios.get(`${HUNTER_API_URL}/domain-search`, {
        params: {
          domain,
          api_key: HUNTER_API_KEY
        }
      });
      
      res.json({
        success: true,
        result: response.data.data
      });
    } catch (error) {
      console.error('Domain verification error:', error.response?.data || error.message);
      
      if (error.response && error.response.status === 429) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded. Please try again later.'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Domain verification failed',
        details: error.response?.data || error.message
      });
    }
  });
  
  // Search for contacts
  router.post('/search-contacts', auth, async (req, res) => {
    const { domain, company, seniority, department } = req.body;
    
    if (!domain && !company) {
      return res.status(400).json({ error: 'Domain or company is required' });
    }
    
    try {
      const response = await axios.get(`${HUNTER_API_URL}/domain-search`, {
        params: {
          domain,
          company,
          seniority: seniority?.join(','),
          department: department?.join(','),
          limit: 20,
          api_key: HUNTER_API_KEY
        }
      });
      
      res.json({
        success: true,
        results: response.data.data
      });
    } catch (error) {
      console.error('Contact search error:', error.response?.data || error.message);
      
      if (error.response && error.response.status === 429) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded. Please try again later.'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Contact search failed',
        details: error.response?.data || error.message
      });
    }
  });
  
  module.exports = router;