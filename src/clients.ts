import { google } from 'googleapis';
import * as fs from 'fs';

export let docsClient: any;
export let driveClient: any;

export async function initializeGoogleClient() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  fs.writeFileSync('/tmp/sa.json', saJson);
  
  const auth = new google.auth.GoogleAuth({
    keyFile: '/tmp/sa.json',
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents']
  });

  const authClient = await auth.getClient();
  docsClient = google.docs({ version: 'v1', auth: authClient });
  driveClient = google.drive({ version: 'v3', auth: authClient });
}
