// =============================================================================
// Email Service - Resend API Integration
// =============================================================================

import config from '../config';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.email.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[email-service] Failed to send email:', error);
      return false;
    }

    console.log(`[email-service] Email sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error('[email-service] Error sending email:', error);
    return false;
  }
}

// =============================================================================
// Email Templates
// =============================================================================

const emailStyles = `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; }
    .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .button:hover { background: #5a67d8; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .code { background: #f4f4f5; padding: 15px 25px; font-family: monospace; font-size: 24px; letter-spacing: 4px; text-align: center; border-radius: 6px; margin: 20px 0; }
    .warning { background: #fef3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 6px; margin: 15px 0; }
  </style>
`;

export function getInviteEmailTemplate(params: {
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
  expiresIn: string;
}): { subject: string; html: string } {
  return {
    subject: `You're invited to join ${params.organizationName} on Flowgrid`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 You're Invited!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>${params.inviterName}</strong> has invited you to join <strong>${params.organizationName}</strong> on Flowgrid - the enterprise AI agent platform.</p>
            <p>Click the button below to accept your invitation and create your account:</p>
            <p style="text-align: center;">
              <a href="${params.inviteUrl}" class="button">Accept Invitation</a>
            </p>
            <p class="warning">⏰ This invitation expires in ${params.expiresIn}.</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>Flowgrid - Enterprise AI Agent Platform</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

export function getPasswordResetEmailTemplate(params: {
  userName: string;
  resetUrl: string;
  expiresIn: string;
}): { subject: string; html: string } {
  return {
    subject: 'Reset your Flowgrid password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
          </div>
          <div class="content">
            <p>Hi ${params.userName},</p>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <p style="text-align: center;">
              <a href="${params.resetUrl}" class="button">Reset Password</a>
            </p>
            <p class="warning">⏰ This link expires in ${params.expiresIn}.</p>
            <p>If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            <p>For security, this link can only be used once.</p>
          </div>
          <div class="footer">
            <p>Flowgrid - Enterprise AI Agent Platform</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

export function getMfaSetupEmailTemplate(params: {
  userName: string;
}): { subject: string; html: string } {
  return {
    subject: 'Two-factor authentication enabled on Flowgrid',
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛡️ 2FA Enabled</h1>
          </div>
          <div class="content">
            <p>Hi ${params.userName},</p>
            <p>Two-factor authentication has been successfully enabled on your Flowgrid account.</p>
            <p>From now on, you'll need to enter a verification code from your authenticator app each time you sign in.</p>
            <p><strong>Keep your backup codes safe!</strong> You can use them to access your account if you lose access to your authenticator app.</p>
            <p class="warning">⚠️ If you didn't enable 2FA, please contact support immediately and change your password.</p>
          </div>
          <div class="footer">
            <p>Flowgrid - Enterprise AI Agent Platform</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

export function getWelcomeEmailTemplate(params: {
  userName: string;
  organizationName: string;
  loginUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `Welcome to ${params.organizationName} on Flowgrid!`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 Welcome to Flowgrid!</h1>
          </div>
          <div class="content">
            <p>Hi ${params.userName},</p>
            <p>Your account has been created successfully. You're now part of <strong>${params.organizationName}</strong>.</p>
            <p>With Flowgrid, you can:</p>
            <ul>
              <li>🤖 Create and manage AI agents</li>
              <li>🔗 Connect to ServiceNow and other platforms</li>
              <li>📊 Monitor agent performance and interactions</li>
              <li>🔄 Automate IT workflows intelligently</li>
            </ul>
            <p style="text-align: center;">
              <a href="${params.loginUrl}" class="button">Go to Flowgrid</a>
            </p>
          </div>
          <div class="footer">
            <p>Flowgrid - Enterprise AI Agent Platform</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

export function getSecurityAlertEmailTemplate(params: {
  userName: string;
  alertType: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
}): { subject: string; html: string } {
  return {
    subject: `Security Alert: ${params.alertType}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="header" style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);">
            <h1>⚠️ Security Alert</h1>
          </div>
          <div class="content">
            <p>Hi ${params.userName},</p>
            <p>We detected the following activity on your account:</p>
            <div class="warning">
              <strong>${params.alertType}</strong><br>
              ${params.details}
            </div>
            <p><strong>Details:</strong></p>
            <ul>
              <li>Time: ${params.timestamp}</li>
              ${params.ipAddress ? `<li>IP Address: ${params.ipAddress}</li>` : ''}
            </ul>
            <p>If this was you, you can ignore this email. If you don't recognize this activity, please change your password immediately and contact support.</p>
          </div>
          <div class="footer">
            <p>Flowgrid - Enterprise AI Agent Platform</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };
}

export default {
  sendEmail,
  getInviteEmailTemplate,
  getPasswordResetEmailTemplate,
  getMfaSetupEmailTemplate,
  getWelcomeEmailTemplate,
  getSecurityAlertEmailTemplate,
};
