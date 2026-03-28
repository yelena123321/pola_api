/**
 * user-preference Routes
 * Auto-extracted from server.js
 */
const express = require('express');

module.exports = function(deps) {
  const router = express.Router();
  const { pool, jwt, bcrypt, JWT_SECRET, REFRESH_TOKEN_SECRET, authenticateToken, verifyAdminRole, logActivity, sendEmailWithRetry, sendEmailViaRelay, formatPhoneNumber, uploadToCloudinary, uploadCompanyLogo, uploadProfilePhoto, SWISS_CANTONS, SWISS_LEAVE_MINIMUMS, cloudinary, nodemailer, logTenantViolation, emailTransporter, EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, persistentUsers, persistentTimers, dailyLimits, persistentVacationBalances, persistentActivities, addActivity, tempCompanyRegistrations, forgotPasswordOTPs, companySettings, userPreferences, savePersistentData, fileUpload } = deps;

// ========== USER PREFERENCES APIs (Based on Figma Screens) ==========

// GET User Preferences
router.get('/user/preferences', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const preferences = userPreferences[userId] || {
    user_id: userId,
    language: "English",
    language_code: "en",
    time_format: "24-hour",
    first_day_of_week: "Monday",
    timezone: "UTC",
    date_format: "YYYY-MM-DD",
    updated_at: new Date().toISOString()
  };
  
  res.json({
    success: true,
    message: "User preferences retrieved successfully",
    data: { preferences }
  });
});

// UPDATE Language
router.put('/user/preferences/language', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { language, language_code } = req.body;
  
  if (!language) {
    return res.status(400).json({
      success: false,
      message: "Language is required"
    });
  }
  
  if (!userPreferences[userId]) {
    userPreferences[userId] = {
      user_id: userId,
      language: "English",
      language_code: "en",
      time_format: "24-hour",
      first_day_of_week: "Monday",
      timezone: "UTC",
      date_format: "YYYY-MM-DD"
    };
  }
  
  userPreferences[userId].language = language;
  if (language_code) {
    userPreferences[userId].language_code = language_code;
  }
  userPreferences[userId].updated_at = new Date().toISOString();
  
  res.json({
    success: true,
    message: "Language updated successfully",
    data: {
      language: userPreferences[userId].language,
      language_code: userPreferences[userId].language_code,
      updated_at: userPreferences[userId].updated_at
    }
  });
});

// UPDATE Time Format
router.put('/user/preferences/time-format', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { time_format } = req.body;
  
  if (!time_format || !["24-hour", "12-hour"].includes(time_format)) {
    return res.status(400).json({
      success: false,
      message: "Valid time format is required (24-hour or 12-hour)"
    });
  }
  
  if (!userPreferences[userId]) {
    userPreferences[userId] = {
      user_id: userId,
      language: "English",
      language_code: "en",
      time_format: "24-hour",
      first_day_of_week: "Monday",
      timezone: "UTC",
      date_format: "YYYY-MM-DD"
    };
  }
  
  userPreferences[userId].time_format = time_format;
  userPreferences[userId].updated_at = new Date().toISOString();
  
  res.json({
    success: true,
    message: "Time format successfully updated",
    data: {
      time_format: userPreferences[userId].time_format,
      updated_at: userPreferences[userId].updated_at
    }
  });
});

// UPDATE First Day of Week
router.put('/user/preferences/first-day-of-week', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { first_day_of_week } = req.body;
  
  if (!first_day_of_week || !["Monday", "Sunday"].includes(first_day_of_week)) {
    return res.status(400).json({
      success: false,
      message: "Valid first day of week is required (Monday or Sunday)"
    });
  }
  
  if (!userPreferences[userId]) {
    userPreferences[userId] = {
      user_id: userId,
      language: "English",
      language_code: "en",
      time_format: "24-hour",
      first_day_of_week: "Monday",
      timezone: "UTC",
      date_format: "YYYY-MM-DD"
    };
  }
  
  userPreferences[userId].first_day_of_week = first_day_of_week;
  userPreferences[userId].updated_at = new Date().toISOString();
  
  res.json({
    success: true,
    message: "First day of week successfully updated",
    data: {
      first_day_of_week: userPreferences[userId].first_day_of_week,
      updated_at: userPreferences[userId].updated_at
    }
  });
});

// UPDATE All Preferences at Once
router.put('/user/preferences', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { language, language_code, time_format, first_day_of_week, timezone, date_format } = req.body;
  
  if (!userPreferences[userId]) {
    userPreferences[userId] = {
      user_id: userId,
      language: "English",
      language_code: "en",
      time_format: "24-hour",
      first_day_of_week: "Monday",
      timezone: "UTC",
      date_format: "YYYY-MM-DD"
    };
  }
  
  if (language) userPreferences[userId].language = language;
  if (language_code) userPreferences[userId].language_code = language_code;
  if (time_format) userPreferences[userId].time_format = time_format;
  if (first_day_of_week) userPreferences[userId].first_day_of_week = first_day_of_week;
  if (timezone) userPreferences[userId].timezone = timezone;
  if (date_format) userPreferences[userId].date_format = date_format;
  
  userPreferences[userId].updated_at = new Date().toISOString();
  
  res.json({
    success: true,
    message: "User preferences updated successfully",
    data: { preferences: userPreferences[userId] }
  });
});

// GET Available Languages
router.get('/languages', authenticateToken, (req, res) => {
  const languages = [
    { id: 1, name: "Switzerland", code: "de-CH", flag: "🇨🇭" },
    { id: 2, name: "English", code: "en", flag: "🇺🇸" },
    { id: 3, name: "Spanish", code: "es", flag: "🇪🇸" },
    { id: 4, name: "Germany", code: "de", flag: "🇩🇪" },
    { id: 5, name: "Japan", code: "ja", flag: "🇯🇵" },
    { id: 6, name: "Indonesia", code: "id", flag: "🇮🇩" },
    { id: 7, name: "Italy", code: "it", flag: "🇮🇹" },
    { id: 8, name: "Netherlands", code: "nl", flag: "🇳🇱" }
  ];
  
  res.json({
    success: true,
    message: "Languages retrieved successfully",
    data: { languages }
  });
});


  return router;
};
