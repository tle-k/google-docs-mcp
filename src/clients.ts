import { google } from 'googleapis';
import { logger } from './logger.js';
import * as fs from 'fs';

export let docsClient: any;
export let driveClient: any;
export let sheetsClient: any;
export let gmailClient: any;
export let calendarClient: any;

export async function initializeGoogleClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    logger.error("FATAL: GOOGLE_SERVICE_ACCOUNT_JSON is missing!");
    process.exit(1);
  }

  // Write directly to file system to avoid mobile JSON.parse() newline crashes
  fs.writeFileSync('/tmp/service-account.json', process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  
  const auth = new google.auth.GoogleAuth({
    keyFile: '/tmp/service-account.json',
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  });

  logger.info("Successfully loaded Service Account credentials.");

  docsClient = google.docs({ version: 'v1', auth });
  driveClient = google.drive({ version: 'v3', auth });
  sheetsClient = google.sheets({ version: 'v4', auth });
  gmailClient = google.gmail({ version: 'v1', auth });
  calendarClient = google.calendar({ version: 'v3', auth });
}
