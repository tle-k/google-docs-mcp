import { google } from 'googleapis';
import * as fs from 'fs';

let docsClient: any;
let driveClient: any;
let sheetsClient: any;
let gmailClient: any;
let calendarClient: any;
let authClient: any;
let scriptClient: any;

export async function initializeGoogleClient() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error("FATAL: GOOGLE_SERVICE_ACCOUNT_JSON missing!");
    process.exit(1);
  }

  fs.writeFileSync('/tmp/sa.json', saJson);
  
  const auth = new google.auth.GoogleAuth({
    keyFile: '/tmp/sa.json',
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/script.projects'
    ]
  });

  authClient = await auth.getClient();
  docsClient = google.docs({ version: 'v1', auth: authClient as any });
  driveClient = google.drive({ version: 'v3', auth: authClient as any });
  sheetsClient = google.sheets({ version: 'v4', auth: authClient as any });
  gmailClient = google.gmail({ version: 'v1', auth: authClient as any });
  calendarClient = google.calendar({ version: 'v3', auth: authClient as any });
  scriptClient = google.script({ version: 'v1', auth: authClient as any });
}

export const getDocsClient = () => docsClient;
export const getDriveClient = () => driveClient;
export const getSheetsClient = () => sheetsClient;
export const getGmailClient = () => gmailClient;
export const getCalendarClient = () => calendarClient;
export const getAuthClient = () => authClient;
export const getScriptClient = () => scriptClient;
