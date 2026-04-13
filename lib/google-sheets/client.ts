import { google } from "googleapis";

const ensureEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value;
};

export const getSheetsClient = async () => {
  const clientEmail = ensureEnv("GOOGLE_CLIENT_EMAIL");
  const privateKey = ensureEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return {
    sheets: google.sheets({ version: "v4", auth }),
    spreadsheetId: ensureEnv("GOOGLE_SHEET_ID")
  };
};
