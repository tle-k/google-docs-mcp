import { google } from 'googleapis';
import { logger } from './logger.js';

export let docsClient: any;
export let driveClient: any;
export let sheetsClient: any;
export let gmailClient: any;
export let calendarClient: any;

export async function initializeGoogleClient() {
  let auth;
  
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // Parse the JSON variable natively in memory
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    logger.info("Authenticated using Service Account JSON.");
  } else {
    // Native fallback for local desktop usage
    const { getOAuthClient } = await import('./auth.js');
    auth = await getOAuthClient();
    logger.info("Authenticated using local OAuth token.");
  }

  docsClient = google.docs({ version: 'v1', auth });
  driveClient = google.drive({ version: 'v3', auth });
  sheetsClient = google.sheets({ version: 'v4', auth });
  gmailClient = google.gmail({ version: 'v1', auth });
  calendarClient = google.calendar({ version: 'v3', auth });
}
