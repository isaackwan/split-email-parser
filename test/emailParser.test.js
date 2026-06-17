import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
  stripHtml,
  decodeEntities,
  parseTransactionText,
  parseEmail,
  TRANSACTION_TYPES,
  PAYME_TRANSACTION_TYPES,
  WISE_TRANSACTION_TYPES,
  CURRENCY_NAMES,
  CHANNELS,
} from '../src/emailParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------
describe('stripHtml', () => {
  it('removes opening and closing tags', () => {
    assert.equal(stripHtml('<b>hello</b>'), 'hello');
  });

  it('removes self-closing tags', () => {
    assert.equal(stripHtml('foo<br/>bar'), 'foobar');
  });

  it('removes tags with attributes', () => {
    assert.equal(
      stripHtml('<meta http-equiv="Content-Type" content="text/html" />text'),
      'text'
    );
  });

  it('leaves plain text unchanged', () => {
    assert.equal(stripHtml('no tags here'), 'no tags here');
  });

  it('handles nested tags', () => {
    assert.equal(stripHtml('<html><body>content</body></html>'), 'content');
  });
});

// ---------------------------------------------------------------------------
// decodeEntities
// ---------------------------------------------------------------------------
describe('decodeEntities', () => {
  it('decodes &amp;', () => assert.equal(decodeEntities('a&amp;b'), 'a&b'));
  it('decodes &lt; and &gt;', () =>
    assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>'));
  it('decodes &nbsp;', () =>
    assert.equal(decodeEntities('a&nbsp;b'), 'a b'));
  it('decodes numeric entities', () =>
    assert.equal(decodeEntities('&#65;'), 'A'));
  it('leaves regular text unchanged', () =>
    assert.equal(decodeEntities('hello world'), 'hello world'));
});

// ---------------------------------------------------------------------------
// parseTransactionText — unit tests with inline strings
// ---------------------------------------------------------------------------
describe('parseTransactionText', () => {
  it('parses a PURCHASE in HKD', () => {
    const text =
      '閣下信用卡3498於2026-06-01 16:19成功消費2.30港幣，交易場所:HONG KONG TRAMWAY95800   HONGKONG    HK。如懷疑電(852) 218 95588【中國工商銀行(亞洲)】';

    const result = parseTransactionText(text);

    assert.equal(result.channel, CHANNELS.ICBCA);
    assert.equal(result.cardLast4, '3498');
    assert.equal(result.type, TRANSACTION_TYPES.PURCHASE);
    assert.equal(result.amount, 2.3);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.merchantRaw, 'HONG KONG TRAMWAY95800   HONGKONG    HK');
    assert.ok(result.date instanceof Date);
    assert.ok(!isNaN(result.date.getTime()), 'date should be valid');
    // 2026-06-01 16:19 HKT = 2026-06-01 08:19 UTC
    assert.equal(result.date.toISOString(), '2026-06-01T08:19:00.000Z');
  });

  it('parses a PRE_AUTH in HKD', () => {
    const text =
      '閣下信用卡5235於2026-05-31 10:00成功預授權支出0.03港幣，交易場所:MT        MTR - RideHONGKONG    HKG。如懷疑電(852) 218 95588【中國工商銀行(亞洲)】';

    const result = parseTransactionText(text);

    assert.equal(result.channel, CHANNELS.ICBCA);
    assert.equal(result.cardLast4, '5235');
    assert.equal(result.type, TRANSACTION_TYPES.PRE_AUTH);
    assert.equal(result.amount, 0.03);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.merchantRaw, 'MT        MTR - RideHONGKONG    HKG');
    assert.equal(result.date.toISOString(), '2026-05-31T02:00:00.000Z');
  });

  it('parses a USD transaction', () => {
    const text =
      '閣下信用卡3498於2026-06-10 09:30成功消費19.99美元，交易場所:AMAZON.COM AMZN.COM/BI WA US。如懷疑電(852) 218 95588【中國工商銀行(亞洲)】';

    const result = parseTransactionText(text);

    assert.equal(result.currency, 'USD');
    assert.equal(result.amount, 19.99);
    assert.equal(result.merchantRaw, 'AMAZON.COM AMZN.COM/BI WA US');
  });

  it('parses a 加拿大元 (CAD) transaction', () => {
    const text =
      '閣下信用卡3498於2026-06-10 14:00成功消費50.00加拿大元，交易場所:TIM HORTONS TORONTO。如懷疑電(852) 218 95588';

    const result = parseTransactionText(text);

    assert.equal(result.currency, 'CAD');
    assert.equal(result.amount, 50.0);
  });

  it('handles large decimal amounts', () => {
    const text =
      '閣下信用卡9999於2026-06-15 12:00成功消費1234.56港幣，交易場所:SOME MERCHANT。如懷疑電(852) 218 95588';

    const result = parseTransactionText(text);

    assert.equal(result.amount, 1234.56);
  });

  it('parses amounts with comma thousands separators (e.g. 10,571.97)', () => {
    const text =
      '閣下信用卡3498於2026-06-13 07:34成功消費10,571.97港幣，交易場所:AIRBNB * HMH4DQPTSK 128-520-3333 GB。如懷疑電(852) 218 95588【中國工商銀行(亞洲)】';

    const result = parseTransactionText(text);

    assert.equal(result.amount, 10571.97);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.merchantRaw, 'AIRBNB * HMH4DQPTSK 128-520-3333 GB');
  });

  it('throws on unrecognisable text', () => {
    assert.throws(
      () => parseTransactionText('This is a completely unrelated email'),
      /Could not parse transaction/
    );
  });

  it('throws on empty string', () => {
    assert.throws(() => parseTransactionText(''), /Could not parse transaction/);
  });
});

// ---------------------------------------------------------------------------
// CURRENCY_NAMES — registry sanity checks
// ---------------------------------------------------------------------------
describe('CURRENCY_NAMES registry', () => {
  it('maps 港幣 to HKD', () => assert.equal(CURRENCY_NAMES['港幣'], 'HKD'));
  it('maps 美元 to USD', () => assert.equal(CURRENCY_NAMES['美元'], 'USD'));
  it('maps 加拿大元 to CAD', () => assert.equal(CURRENCY_NAMES['加拿大元'], 'CAD'));
  it('maps 加元 to CAD (short form)', () => assert.equal(CURRENCY_NAMES['加元'], 'CAD'));
  it('maps 人民幣 to CNY', () => assert.equal(CURRENCY_NAMES['人民幣'], 'CNY'));
});

// ---------------------------------------------------------------------------
// parseEmail — integration tests using real MIME fixture files
// ---------------------------------------------------------------------------
describe('parseEmail (integration)', () => {
  it('parses the ICBCA PURCHASE fixture end-to-end', async () => {
    const raw = fixture('icbca-purchase.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.ICBCA);
    assert.equal(result.cardLast4, '3498');
    assert.equal(result.type, TRANSACTION_TYPES.PURCHASE);
    assert.equal(result.amount, 2.3);
    assert.equal(result.currency, 'HKD');
    assert.ok(result.merchantRaw.includes('HONG KONG TRAMWAY'));
    assert.equal(result.date.toISOString(), '2026-06-01T08:19:00.000Z');
  });

  it('parses the ICBCA PRE_AUTH fixture end-to-end', async () => {
    const raw = fixture('icbca-preauth.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.ICBCA);
    assert.equal(result.cardLast4, '5235');
    assert.equal(result.type, TRANSACTION_TYPES.PRE_AUTH);
    assert.equal(result.amount, 0.03);
    assert.equal(result.currency, 'HKD');
    assert.ok(result.merchantRaw.includes('MTR'));
    assert.equal(result.date.toISOString(), '2026-05-31T02:00:00.000Z');
  });

  it('parses the PayMe PURCHASE fixture end-to-end', async () => {
    const raw = fixture('payme-purchase.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.PAYME);
    assert.equal(result.cardLast4, null);
    assert.equal(result.type, PAYME_TRANSACTION_TYPES.PURCHASE);
    assert.equal(result.amount, 31.64);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.originalAmount, 15.9);
    assert.equal(result.originalCurrency, 'MYR');
    assert.equal(result.merchantRaw, 'Four Beans Ventures Sdn BIpoh MYS');
    assert.equal(result.date.toISOString(), '2026-03-27T13:06:00.000Z');
  });

  it('parses the PayMe PRE_AUTH fixture end-to-end', async () => {
    const raw = fixture('payme-preauth.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.PAYME);
    assert.equal(result.cardLast4, null);
    assert.equal(result.type, PAYME_TRANSACTION_TYPES.PRE_AUTH);
    assert.equal(result.amount, 78.39);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.originalAmount, 39);
    assert.equal(result.originalCurrency, 'MYR');
    assert.equal(result.merchantRaw, 'LI ER NYONYA-SUSHI Georgetown MY');
    assert.equal(result.date.toISOString(), '2026-04-12T06:13:00.000Z');
  });

  it('parses the Wise PURCHASE fixture end-to-end', async () => {
    const raw = fixture('wise-purchase.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.WISE);
    assert.equal(result.cardLast4, null);
    assert.equal(result.type, WISE_TRANSACTION_TYPES.PURCHASE);
    assert.equal(result.amount, 69.56);
    assert.equal(result.currency, 'HKD');
    assert.equal(result.merchantRaw, 'iHerb');
    assert.equal(result.date.toISOString(), '2026-04-11T12:04:56.000Z');
  });

  it('parses the Wise PURCHASE fixture with the transaction currency and amount', async () => {
    const raw = fixture('wise-purchase2.eml');
    const result = await parseEmail(raw);

    assert.equal(result.channel, CHANNELS.WISE);
    assert.equal(result.cardLast4, null);
    assert.equal(result.type, WISE_TRANSACTION_TYPES.PURCHASE);
    assert.equal(result.amount, 30);
    assert.equal(result.currency, 'AUD');
    assert.equal(result.merchantRaw, 'OpenAI - ChatGPT Subscription');
    assert.equal(result.date.toISOString(), '2026-06-17T10:33:06.000Z');
  });
});
