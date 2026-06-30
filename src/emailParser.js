import { simpleParser } from 'mailparser';

export class EmailParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailParseError';
  }
}

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

export const CHANNELS = {
  ICBCA: 'ICBCA',
  PAYME: 'PayMe',
  WISE: 'Wise',
  GOOGLE_WALLET: 'Google Wallet',
};

// ---------------------------------------------------------------------------
// Transaction type registry
// Add new types here; the regex and downstream code adapt automatically.
// ---------------------------------------------------------------------------

/** @enum {string} */
export const TRANSACTION_TYPES = {
  PURCHASE: '成功消費',
  PRE_AUTH: '成功預授權支出',
};

export const PAYME_TRANSACTION_TYPES = {
  PURCHASE: 'Payment',
  PRE_AUTH: 'Pending payment',
};

export const WISE_TRANSACTION_TYPES = {
  PURCHASE: 'Spent',
};

// ---------------------------------------------------------------------------
// Currency registry
// Entries are sorted longest-first so the regex alternation never short-circuits
// a longer match (e.g. 加拿大元 must come before 加元).
// ---------------------------------------------------------------------------

/**
 * Maps Chinese currency names → ISO 4217 codes.
 * Extend this object to support additional currencies; the regex rebuilds itself.
 */
export const CURRENCY_NAMES = {
  '加拿大元': 'CAD',
  '人民幣': 'CNY',
  '港幣': 'HKD',
  '美元': 'USD',
  '英鎊': 'GBP',
  '歐元': 'EUR',
  '澳元': 'AUD',
  '紐元': 'NZD',
  '日圓': 'JPY',
  '韓元': 'KRW',
  '加元': 'CAD', // short-form alternate for CAD — keep after 加拿大元
};

// Build regex fragments from the registries so they stay in sync automatically
const txTypePattern = Object.values(TRANSACTION_TYPES)
  .sort((a, b) => b.length - a.length) // longest first prevents partial matches
  .join('|');

const currencyPattern = Object.keys(CURRENCY_NAMES)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * Matches the entire transaction sentence inside the decoded email body.
 *
 * Example input:
 *   閣下信用卡3498於2026-06-01 16:19成功消費2.30港幣，交易場所:HONG KONG TRAMWAY95800   HONGKONG    HK。
 *
 * Capture groups:
 *   1 – card last-4 digits
 *   2 – date-time string "YYYY-MM-DD HH:mm"
 *   3 – transaction type (one of TRANSACTION_TYPES values)
 *   4 – amount (decimal string)
 *   5 – Chinese currency name (one of CURRENCY_NAMES keys)
 *   6 – raw merchant string (up to the first 。)
 */
const TRANSACTION_REGEX = new RegExp(
  `閣下信用卡(\\d+)於(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})(${txTypePattern})([\\d,.]+)(${currencyPattern})，交易場所:(.+?)。`
);

const PAYME_PATTERNS = [
  {
    type: PAYME_TRANSACTION_TYPES.PRE_AUTH,
    status: 'Pending',
    regex:
      /You have a pending payment to the business\s+(.+?)\s+via PayMe\s+-\s+([A-Z]{3})\s+([\d,.]+)(?:\s+\(\s+([A-Z]{3})\s+([\d,.]+)\s+\))?.*?Date and time\s+(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})\s+Payment status\s+Pending/s,
  },
  {
    type: PAYME_TRANSACTION_TYPES.PURCHASE,
    status: 'SUCCESS',
    regex:
      /You paid the business\s+(.+?)\s+via PayMe\s+-\s+([A-Z]{3})\s+([\d,.]+)(?:\s+\(\s+([A-Z]{3})\s+([\d,.]+)\s+\))?.*?Date and time\s+(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})\s+Payment status\s+SUCCESS/s,
  },
];

const WISE_SPEND_REGEX =
  /You spent\s+([\d,.]+)\s+([A-Z]{3})\s+at\s+(.+?)\./;

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/**
 * Strips all HTML tags from a string.
 * Exported for unit testing.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Decodes common HTML entities.
 * Exported for unit testing.
 *
 * @param {string} str
 * @returns {string}
 */
export function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// ---------------------------------------------------------------------------
// Core parsing
// ---------------------------------------------------------------------------

/**
 * Parses the plain-text representation of the email body and returns a
 * structured transaction object.
 *
 * Exported separately from parseEmail so tests can exercise the regex logic
 * without needing a full MIME envelope.
 *
 * @param {string} text  – decoded, tag-stripped body text
 * @param {{ subject?: string, date?: Date }} [context]
 * @returns {Transaction}
 *
 * @typedef {{
 *   channel: string,
 *   cardLast4: string,
 *   date: Date,
 *   type: string,
 *   amount: number,
 *   currency: string,
 *   merchantRaw: string,
 *   settlementAmount?: number,
 *   settlementCurrency?: string,
 * }} Transaction
 */
export function parseTransactionText(text, context = {}) {
  const normalisedText = text.replace(/\s+/g, ' ').trim();

  const payme = parsePayMeTransactionText(normalisedText);
  if (payme) {
    return payme;
  }

  const wise = parseWiseTransactionText(normalisedText, context);
  if (wise) {
    return wise;
  }

  const icbca = parseIcbcaTransactionText(text);
  if (icbca) {
    return icbca;
  }

  throw new EmailParseError(
    `Could not parse transaction from email body. Snippet: "${text.slice(0, 300)}"`
  );
}

function parseIcbcaTransactionText(text) {
  const match = text.match(TRANSACTION_REGEX);
  if (!match) {
    return null;
  }

  const [, cardLast4, dateStr, type, amountStr, currencyName, merchantRaw] = match;

  const currency = CURRENCY_NAMES[currencyName];
  // Guard: should never happen given the regex already validates the key
  if (!currency) {
    throw new Error(`Unrecognised currency name: "${currencyName}"`);
  }

  // The bank sends local HKT times (UTC+8); make that explicit so Date
  // arithmetic is always correct regardless of the server's own timezone.
  const date = new Date(`${dateStr.replace(' ', 'T')}:00+08:00`);

  return {
    channel: CHANNELS.ICBCA,
    cardLast4,
    date,
    type,
    amount: parseDecimalAmount(amountStr),
    currency,
    // Keep the raw merchant string exactly as received.
    // Trimming / normalisation is intentionally deferred here so callers can
    // decide how to handle padding.  See wrapper.sh notes.
    merchantRaw: merchantRaw.trim(),
  };
}

function parsePayMeTransactionText(text) {
  for (const { regex, type, status } of PAYME_PATTERNS) {
    const matches = [...text.matchAll(new RegExp(regex.source, 'gs'))];
    const match = matches.at(-1);
    if (!match) {
      continue;
    }

    const [
      ,
      merchantRaw,
      currency,
      amountStr,
      originalCurrency,
      originalAmountStr,
      hour,
      minute,
      day,
      month,
      year,
    ] = match;
    const merchant = cleanPayMeMerchant(merchantRaw);
    const settlementAmount = parseDecimalAmount(amountStr);
    const settlementCurrency = currency;
    const transactionAmount = originalAmountStr
      ? parseDecimalAmount(originalAmountStr)
      : settlementAmount;
    const transactionCurrency = originalCurrency || settlementCurrency;

    return {
      channel: CHANNELS.PAYME,
      cardLast4: null,
      date: new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`),
      type,
      amount: transactionAmount,
      currency: transactionCurrency,
      merchantRaw: merchant,
      originalCurrency: transactionCurrency,
      originalAmount: transactionAmount,
      settlementCurrency,
      settlementAmount,
      status,
    };
  }

  return null;
}

function cleanPayMeMerchant(merchantRaw) {
  const markers = [
    'You have a pending payment to the business',
    'You paid the business',
  ];
  let merchant = merchantRaw.replace(/(?:&zwnj;\s*)+/g, ' ').trim();

  for (const marker of markers) {
    if (merchant.includes(marker)) {
      merchant = merchant.split(marker).at(-1).trim();
    }
  }

  return merchant;
}

function parseWiseTransactionText(text, { subject, date, receivedDate } = {}) {
  const source = text;
  const match = source.match(WISE_SPEND_REGEX);
  if (!match) {
    if (subject) {
      const subjectMatch = subject.match(/^([\d,.]+)\s+([A-Z]{3})\s+spent at\s+(.+)$/);
      if (!subjectMatch) {
        return null;
      }

      const [, amountStr, currency, merchantRaw] = subjectMatch;
      const transactionDate =
        receivedDate instanceof Date && !isNaN(receivedDate.getTime())
          ? receivedDate
          : date instanceof Date && !isNaN(date.getTime())
            ? date
            : null;
      if (!transactionDate) {
        return null;
      }

      return {
        channel: CHANNELS.WISE,
        cardLast4: null,
        date: transactionDate,
        type: WISE_TRANSACTION_TYPES.PURCHASE,
        amount: parseDecimalAmount(amountStr),
        currency,
        merchantRaw: merchantRaw.trim(),
      };
    }

    return null;
  }

  const [, amountStr, currency, merchantRaw] = match;
  const transactionDate =
    receivedDate instanceof Date && !isNaN(receivedDate.getTime())
      ? receivedDate
      : date instanceof Date && !isNaN(date.getTime())
        ? date
        : null;
  if (!transactionDate || isNaN(transactionDate.getTime())) {
    return null;
  }

  return {
    channel: CHANNELS.WISE,
    cardLast4: null,
    date: transactionDate,
    type: WISE_TRANSACTION_TYPES.PURCHASE,
    amount: parseDecimalAmount(amountStr),
    currency,
    merchantRaw: merchantRaw.trim(),
  };
}

/**
 * Parses a complete raw email (RFC 2822 string read from stdin) and returns
 * a structured transaction object.
 *
 * @param {string} rawEmail
 * @returns {Promise<Transaction>}
 */
export async function parseEmail(rawEmail) {
  const mail = await simpleParser(rawEmail);

  // Prefer the HTML part (always present in these emails); fall back to
  // the plain-text part if somehow the HTML is absent.
  const source = mail.html || mail.text || '';
  if (!source) {
    throw new EmailParseError('Email has no readable text or HTML body');
  }

  const text = decodeEntities(stripHtml(source));
  const receivedDate = getLastReceivedDate(rawEmail);
  return parseTransactionText(text, {
    subject: mail.subject,
    date: mail.date,
    receivedDate,
  });
}

function getLastReceivedDate(rawEmail) {
  const receivedLines = rawEmail.match(/^Received:.*$/gim) || [];
  if (!receivedLines.length) {
    return null;
  }

  const lastLine = receivedLines.at(-1);
  const timestampPart = lastLine?.split(';').at(-1)?.trim();
  if (!timestampPart) {
    return null;
  }

  const parsed = new Date(timestampPart);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parseDecimalAmount(amountStr) {
  return parseFloat(amountStr.replace(/,/g, ''));
}
