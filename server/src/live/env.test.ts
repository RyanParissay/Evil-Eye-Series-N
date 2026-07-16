import { expect, test } from 'vitest';
import { LIVE_ENV_NAMES, REQUIRED_FOR_LIVE, devMode, missingLiveVars, parseEnvFile } from './env.js';

test('the name lists are the controller-supplied set, verbatim', () => {
  expect([...LIVE_ENV_NAMES]).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_FROM', 'WHATSAPP_DEV_MODE', 'PORT', 'APP_URL',
  ]);
  expect([...REQUIRED_FOR_LIVE]).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
});

test('parseEnvFile: KEY=VALUE, export prefix, quotes, comments, blanks', () => {
  const parsed = parseEnvFile([
    '# comment line',
    'ODDS_API_KEY=fake-key-123',
    "export TWILIO_ACCOUNT_SID='ACfake'",
    'TWILIO_AUTH_TOKEN="fake token"',
    '',
    'WHATSAPP_DEV_MODE=true',
    'not a pair',
    'APP_URL=http://localhost:3000 # trailing comments are NOT stripped',
  ].join('\n'));
  expect(parsed.ODDS_API_KEY).toBe('fake-key-123');
  expect(parsed.TWILIO_ACCOUNT_SID).toBe('ACfake');
  expect(parsed.TWILIO_AUTH_TOKEN).toBe('fake token');
  expect(parsed.WHATSAPP_DEV_MODE).toBe('true');
  expect(parsed.APP_URL).toBe('http://localhost:3000 # trailing comments are NOT stripped');
  expect(Object.keys(parsed)).not.toContain('not a pair');
});

test('missingLiveVars reports NAMES only, in canonical order', () => {
  expect(missingLiveVars({})).toEqual([
    'ODDS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
  expect(missingLiveVars({
    ODDS_API_KEY: 'fake', TWILIO_ACCOUNT_SID: 'fake', TWILIO_AUTH_TOKEN: 'fake',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550001111',
  })).toEqual([]);
  expect(missingLiveVars({ ODDS_API_KEY: 'fake' })).toEqual([
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM',
  ]);
});

test('devMode defaults SAFE: only an explicit false/0 means real sends', () => {
  expect(devMode({})).toBe(true);                                   // unset → dev
  expect(devMode({ WHATSAPP_DEV_MODE: 'true' })).toBe(true);
  expect(devMode({ WHATSAPP_DEV_MODE: 'banana' })).toBe(true);      // garbled → dev
  expect(devMode({ WHATSAPP_DEV_MODE: 'false' })).toBe(false);
  expect(devMode({ WHATSAPP_DEV_MODE: '0' })).toBe(false);
});
