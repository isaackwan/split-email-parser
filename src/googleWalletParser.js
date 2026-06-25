import { CHANNELS } from './emailParser.js';

export const GOOGLE_WALLET_PACKAGE = 'com.google.android.apps.walletnfcrel';
export const GOOGLE_WALLET_TRANSACTION_TYPES = {
  PAYMENT: 'Payment',
};

export const GOOGLE_WALLET_CURRENCY_SYMBOLS = {
  'USD$': 'USD',
  'JP¥': 'JPY',
  'HK$': 'HKD',
  'CA$': 'CAD',
  'US$': 'USD',
  'NZ$': 'NZD',
  'C$': 'CAD',
  'A$': 'AUD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
};

const currencySymbolPattern = Object.keys(GOOGLE_WALLET_CURRENCY_SYMBOLS)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');

const PAYMENT_TEXT_REGEX = new RegExp(
  `^(${currencySymbolPattern}|\\$)\\s*([\\d,]+(?:\\.\\d{1,2})?)\\b`
);

export function isIgnorableGoogleWalletNotification(notification) {
  return notification?.title === 'Preparing your receipt'
    && notification?.text === "We're adding the location to your receipt";
}

export function parseGoogleWalletNotification(notification) {
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
    throw new Error('Google Wallet notification payload must be a JSON object');
  }

  if (notification.packageName !== GOOGLE_WALLET_PACKAGE) {
    throw new Error(`Unsupported notification package: ${notification.packageName || '(missing)'}`);
  }

  if (isIgnorableGoogleWalletNotification(notification)) {
    return null;
  }

  const merchantRaw = parseMerchant(notification.title);
  const { amount, currency } = parsePaymentText(notification.text);
  const date = parsePostedAt(notification.postedAt);

  return {
    channel: CHANNELS.GOOGLE_WALLET,
    cardLast4: null,
    date,
    type: GOOGLE_WALLET_TRANSACTION_TYPES.PAYMENT,
    amount,
    currency,
    merchantRaw,
  };
}

function parseMerchant(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new Error('Google Wallet notification is missing a merchant title');
  }
  return title.trim();
}

export function parsePaymentText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Google Wallet notification is missing payment text');
  }

  const match = text.trim().match(PAYMENT_TEXT_REGEX);
  if (!match) {
    throw new Error(`Could not parse Google Wallet payment text: "${text.slice(0, 120)}"`);
  }

  const [, symbol, amountStr] = match;
  if (symbol === '$') {
    throw new Error('Ambiguous Google Wallet currency symbol "$"; use an explicit symbol such as HK$, CA$, or US$');
  }

  return {
    currency: GOOGLE_WALLET_CURRENCY_SYMBOLS[symbol],
    amount: parseFloat(amountStr.replace(/,/g, '')),
  };
}

function parsePostedAt(postedAt) {
  if (typeof postedAt !== 'number' || !Number.isFinite(postedAt)) {
    throw new Error('Google Wallet notification is missing numeric postedAt');
  }

  const date = new Date(postedAt);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid Google Wallet postedAt timestamp: ${postedAt}`);
  }

  return date;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
