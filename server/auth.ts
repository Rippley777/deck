import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { Pool } from 'pg';
import { MssqlDialect } from 'kysely';
import * as Tedious from 'tedious';
import * as Tarn from 'tarn';
import nodemailer from 'nodemailer';
import { EmailClient } from '@azure/communication-email';

export const azureSql = process.env.DATABASE_PROVIDER === 'mssql';
export const emailEnabled = !!(
  process.env.SMTP_URL || process.env.AZURE_COMMUNICATION_CONNECTION_STRING
);
export const entraEnabled = !!(
  process.env.ENTRA_TENANT_ID &&
  process.env.ENTRA_CLIENT_ID &&
  process.env.ENTRA_CLIENT_SECRET
);
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const required = azureSql
  ? ['AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD']
  : ['DATABASE_URL'];
if (emailEnabled) required.push('MAIL_FROM');
for (const key of ['BETTER_AUTH_SECRET', 'APP_URL', ...required]) {
  if (!process.env[key]) throw new Error(`Missing server configuration: ${key}`);
}
if (!emailEnabled && !entraEnabled && !googleEnabled)
  throw new Error('Configure an email transport, Google Sign-In, or Entra External ID');
export const origin = new URL(process.env.APP_URL!).origin;
if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
  throw new Error('Production requires HTTPS');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const database = azureSql
  ? {
      type: 'mssql' as const,
      dialect: new MssqlDialect({
        tarn: { ...Tarn, options: { min: 0, max: 3 } },
        tedious: {
          ...Tedious,
          connectionFactory: () =>
            new Tedious.Connection({
              server: process.env.AZURE_SQL_SERVER!,
              authentication: {
                type: 'default',
                options: {
                  userName: process.env.AZURE_SQL_USER!,
                  password: process.env.AZURE_SQL_PASSWORD!,
                },
              },
              options: {
                database: process.env.AZURE_SQL_DATABASE!,
                port: 1433,
                encrypt: true,
                trustServerCertificate: false,
              },
            }),
          TYPES: { ...Tedious.TYPES, DateTime: Tedious.TYPES.DateTime2 },
        },
      }),
    }
  : pool;
const mail = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const azureMail = process.env.AZURE_COMMUNICATION_CONNECTION_STRING
  ? new EmailClient(process.env.AZURE_COMMUNICATION_CONNECTION_STRING)
  : null;
async function send(to: string, subject: string, url: string) {
  // Never log verification/reset URLs or tokens.
  const text = `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this email.`;
  if (azureMail) {
    const delivery = await azureMail.beginSend({
      senderAddress: process.env.MAIL_FROM!.match(/<([^>]+)>/)?.[1] || process.env.MAIL_FROM!,
      content: { subject, plainText: text },
      recipients: { to: [{ address: to }] },
    });
    await delivery.pollUntilDone();
  } else {
    await mail!.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
  }
}
export const auth = betterAuth({
  database,
  baseURL: origin,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [origin],
  advanced: {
    ipAddress: { ipAddressHeaders: ['x-deck-client-ip'] },
    useSecureCookies: process.env.NODE_ENV === 'production',
    database: { generateId: () => crypto.randomUUID() },
  },
  emailAndPassword: {
    enabled: emailEnabled,
    requireEmailVerification: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await send(user.email, 'Reset your Deck password', url);
    },
  },
  emailVerification: emailEnabled
    ? {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
          await send(user.email, 'Verify your Deck email', url);
        },
      }
    : undefined,
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  plugins: entraEnabled
    ? [
        genericOAuth({
          config: [
            {
              providerId: 'entra',
              clientId: process.env.ENTRA_CLIENT_ID!,
              clientSecret: process.env.ENTRA_CLIENT_SECRET!,
              discoveryUrl: `https://${process.env.ENTRA_DOMAIN! || process.env.ENTRA_TENANT_ID! + '.ciamlogin.com'}/${process.env.ENTRA_TENANT_ID!}/v2.0/.well-known/openid-configuration`,
              requireIdTokenVerification: true,
              scopes: ['openid', 'profile', 'email'],
            },
          ],
        }),
      ]
    : [],
  account: {
    accountLinking: { enabled: true, trustedProviders: ['google'], allowDifferentEmails: false },
  },
  user: {
    changeEmail: { enabled: true },
    deleteUser: {
      enabled: emailEnabled,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await send(user.email, 'Confirm deletion of your Deck account', url);
      },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, freshAge: 60 * 10 },
  rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
});
