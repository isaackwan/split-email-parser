import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_WALLET_CURRENCY_SYMBOLS,
  parseGoogleWalletNotification,
  parsePaymentText,
} from '../src/googleWalletParser.js';
import { CHANNELS } from '../src/emailParser.js';

const baseNotification = {
  deviceId: '1ecdf580411e4ca3',
  packageName: 'com.google.android.apps.walletnfcrel',
  appName: 'Google Wallet',
  title: 'S F EXPRESS HONG KONG',
  text: 'HK$17.00 with hsbchk emtwoo',
  postedAt: 1782354559394,
  notificationKey: '0|com.google.android.apps.walletnfcrel|1001|-292597850|10421',
};

describe('parseGoogleWalletNotification', () => {
  it('parses a Google Wallet HKD payment notification', () => {
    const result = parseGoogleWalletNotification(baseNotification);

    assert.equal(result.channel, CHANNELS.GOOGLE_WALLET);
    assert.equal(result.cardLast4, null);
    assert.equal(result.type, 'Payment');
    assert.equal(result.amount, 17);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.merchantRaw, 'S F EXPRESS HONG KONG');
    assert.equal(result.date.toISOString(), '2026-06-25T02:29:19.394Z');
  });

  it('ignores receipt-preparation notifications', () => {
    const result = parseGoogleWalletNotification({
      ...baseNotification,
      title: 'Preparing your receipt',
      text: "We're adding the location to your receipt",
      postedAt: 1782354560036,
    });

    assert.equal(result, null);
  });

  it('rejects unsupported packages', () => {
    assert.throws(
      () => parseGoogleWalletNotification({
        ...baseNotification,
        packageName: 'com.example.other',
      }),
      /Unsupported notification package/
    );
  });

  it('rejects malformed payloads', () => {
    assert.throws(
      () => parseGoogleWalletNotification(null),
      /payload must be a JSON object/
    );
  });
});

describe('parsePaymentText', () => {
  it('parses explicit CAD symbols', () => {
    assert.deepEqual(parsePaymentText('CA$12.34 with card'), {
      amount: 12.34,
      currency: 'CAD',
    });
    assert.deepEqual(parsePaymentText('C$1,234.56 with card'), {
      amount: 1234.56,
      currency: 'CAD',
    });
  });

  it('parses explicit USD symbols', () => {
    assert.deepEqual(parsePaymentText('US$12.34 with card'), {
      amount: 12.34,
      currency: 'USD',
    });
    assert.deepEqual(parsePaymentText('USD$12.34 with card'), {
      amount: 12.34,
      currency: 'USD',
    });
  });

  it('rejects plain ambiguous dollar symbols', () => {
    assert.throws(
      () => parsePaymentText('$17.00 with card'),
      /Ambiguous Google Wallet currency symbol/
    );
  });

  it('contains the expected currency symbol registry entries', () => {
    assert.equal(GOOGLE_WALLET_CURRENCY_SYMBOLS['HK$'], 'HKD');
    assert.equal(GOOGLE_WALLET_CURRENCY_SYMBOLS['CA$'], 'CAD');
    assert.equal(GOOGLE_WALLET_CURRENCY_SYMBOLS['US$'], 'USD');
    assert.equal(GOOGLE_WALLET_CURRENCY_SYMBOLS['€'], 'EUR');
    assert.equal(GOOGLE_WALLET_CURRENCY_SYMBOLS['£'], 'GBP');
  });
});
