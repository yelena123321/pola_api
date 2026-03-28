/**
 * Date Utilities for Holiday Management
 * Includes Easter calculation and movable holiday date computation
 */

/**
 * Calculate Easter Sunday date for a given year
 * Uses the Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
 * @param {number} year - The year to calculate Easter for
 * @returns {Date} - Easter Sunday date
 */
const calculateEaster = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
};

/**
 * Parse Easter-based calculation formula and return actual date
 * Supports: EASTER, EASTER+N, EASTER-N
 * @param {string} calculation - Formula like 'EASTER+1', 'EASTER-2', 'EASTER+39'
 * @param {number} year - The year to calculate for
 * @returns {Date|null} - Calculated date or null if invalid
 */
const calculateMovableDate = (calculation, year) => {
  if (!calculation || typeof calculation !== 'string') {
    return null;
  }

  const formula = calculation.toUpperCase().trim();
  
  // Handle exact EASTER
  if (formula === 'EASTER') {
    return calculateEaster(year);
  }

  // Handle EASTER+N or EASTER-N
  const match = formula.match(/^EASTER([+-])(\d+)$/);
  if (!match) {
    return null;
  }

  const operator = match[1];
  const days = parseInt(match[2], 10);
  const easter = calculateEaster(year);

  if (operator === '+') {
    easter.setDate(easter.getDate() + days);
  } else {
    easter.setDate(easter.getDate() - days);
  }

  return easter;
};

/**
 * Parse fixed date (MM-DD) and return full date for given year
 * @param {string} fixedDate - Date in MM-DD format (e.g., '01-01', '08-15')
 * @param {number} year - The year
 * @returns {Date|null} - Full date or null if invalid
 */
const parseFixedDate = (fixedDate, year) => {
  if (!fixedDate || typeof fixedDate !== 'string') {
    return null;
  }

  const match = fixedDate.match(/^(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const month = parseInt(match[1], 10) - 1; // 0-indexed
  const day = parseInt(match[2], 10);

  // Validate month and day
  if (month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }

  return new Date(year, month, day);
};

/**
 * Format date to ISO date string (YYYY-MM-DD)
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
const formatDateISO = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date)) {
    return null;
  }
  return date.toISOString().split('T')[0];
};

/**
 * Format date to display format (e.g., "Monday, January 1, 2026")
 * @param {Date} date - Date object
 * @param {string} locale - Locale string (default: 'en-US')
 * @returns {string} - Formatted date string
 */
const formatDateDisplay = (date, locale = 'en-US') => {
  if (!date || !(date instanceof Date) || isNaN(date)) {
    return null;
  }
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Get day of week name
 * @param {Date} date - Date object
 * @returns {string} - Day name (e.g., 'Monday')
 */
const getDayOfWeek = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date)) {
    return null;
  }
  return date.toLocaleDateString('en-US', { weekday: 'long' });
};

/**
 * Calculate holiday date based on type (FIXED or MOVABLE)
 * @param {Object} holiday - Holiday object with date_type, fixed_date, calculation
 * @param {number} year - The year to calculate for
 * @returns {Date|null} - Calculated date
 */
const getHolidayDate = (holiday, year) => {
  if (holiday.date_type === 'FIXED') {
    return parseFixedDate(holiday.fixed_date, year);
  } else if (holiday.date_type === 'MOVABLE') {
    return calculateMovableDate(holiday.calculation, year);
  }
  return null;
};

/**
 * Get all Swiss canton codes
 * @returns {string[]} - Array of canton codes
 */
const getSwissCantons = () => {
  return [
    'ZH', // Zürich
    'BE', // Bern
    'LU', // Luzern
    'UR', // Uri
    'SZ', // Schwyz
    'OW', // Obwalden
    'NW', // Nidwalden
    'GL', // Glarus
    'ZG', // Zug
    'FR', // Fribourg
    'SO', // Solothurn
    'BS', // Basel-Stadt
    'BL', // Basel-Landschaft
    'SH', // Schaffhausen
    'AR', // Appenzell Ausserrhoden
    'AI', // Appenzell Innerrhoden
    'SG', // St. Gallen
    'GR', // Graubünden
    'AG', // Aargau
    'TG', // Thurgau
    'TI', // Ticino
    'VD', // Vaud
    'VS', // Valais
    'NE', // Neuchâtel
    'GE', // Geneva
    'JU'  // Jura
  ];
};

/**
 * Validate canton code
 * @param {string} canton - Canton code to validate
 * @returns {boolean} - True if valid canton code
 */
const isValidCanton = (canton) => {
  if (!canton || typeof canton !== 'string') {
    return false;
  }
  return getSwissCantons().includes(canton.toUpperCase());
};

/**
 * Common Easter-based holiday calculations reference
 */
const EASTER_FORMULAS = {
  'GOOD_FRIDAY': 'EASTER-2',
  'EASTER_SUNDAY': 'EASTER',
  'EASTER_MONDAY': 'EASTER+1',
  'ASCENSION': 'EASTER+39',
  'WHIT_SUNDAY': 'EASTER+49',
  'WHIT_MONDAY': 'EASTER+50',
  'CORPUS_CHRISTI': 'EASTER+60'
};

module.exports = {
  calculateEaster,
  calculateMovableDate,
  parseFixedDate,
  formatDateISO,
  formatDateDisplay,
  getDayOfWeek,
  getHolidayDate,
  getSwissCantons,
  isValidCanton,
  EASTER_FORMULAS
};
