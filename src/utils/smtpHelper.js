const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');

/**
 * Get Clinic/Tenant SMTP Configuration
 * Priority:
 * 1. Tenant-specific SMTP from database (tenant_{id}_smtp_config)
 * 2. Fallback to default .env Superadmin SMTP without modifying it
 */
const getTenantSmtpConfig = async (tenantId) => {
  const { decrypt } = require('./cryptoHelper');

  if (tenantId) {
    try {
      const tid = parseInt(tenantId, 10);
      // GlobalSettings unique constraint is on [tenant_id, key] compound key
      const setting = await prisma.globalSettings.findFirst({
        where: {
          key: `tenant_${tid}_smtp_config`,
          tenant_id: tid
        }
      });

      if (setting?.value) {
        const parsed = JSON.parse(setting.value);
        if (parsed.smtpPass) {
          parsed.smtpPass = decrypt(parsed.smtpPass);
        }
        if (parsed && parsed.isSmtpActive !== false && parsed.smtpHost && parsed.smtpPass) {
          return {
            ...parsed,
            isCustomTenantSmtp: true
          };
        }
      }
    } catch (err) {
      console.warn(`[SMTP Helper] Failed to load custom SMTP for tenant #${tenantId}:`, err.message);
    }
  }

  // Check Global SMTP configuration saved in database
  try {
    const globalSetting = await prisma.globalSettings.findFirst({
      where: {
        key: 'global_smtp_config',
        tenant_id: null
      }
    });

    if (globalSetting?.value) {
      const parsed = JSON.parse(globalSetting.value);
      if (parsed.smtpPass) {
        parsed.smtpPass = decrypt(parsed.smtpPass);
      }
      if (parsed && parsed.isSmtpActive !== false && parsed.smtpHost && parsed.smtpPass) {
        return {
          ...parsed,
          isCustomTenantSmtp: true,
          isGlobalConfig: true
        };
      }
    }
  } catch (err) {
    console.warn('[SMTP Helper] Failed to load global SMTP config:', err.message);
  }

  // Fallback to Superadmin .env configuration (Never overwritten)
  return {
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || 'deephysioclinic@gmail.com',
    smtpPass: process.env.SMTP_PASS || '',
    fromEmail: process.env.SMTP_FROM || 'noreply@deephysio.com',
    fromName: 'DeePhysio Healthcare Platform',
    isSmtpActive: true,
    isCustomTenantSmtp: false
  };
};

/**
 * Create a Nodemailer Transporter for a Tenant
 */
const createTenantTransporter = async (tenantId, overrideConfig = null) => {
  const config = overrideConfig || (await getTenantSmtpConfig(tenantId));

  const port = parseInt(config.smtpPort || '587', 10);
  const secure = port === 465 || config.secure === true || config.secure === 'true';

  const isSimulated = !config.smtpPass || config.smtpPass === 'your-app-password';

  if (isSimulated) {
    return {
      transporter: null,
      config,
      isSimulated: true
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: port,
    secure: secure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return {
    transporter,
    config,
    isSimulated: false
  };
};

/**
 * Test SMTP Credentials & Send a live test email
 */
const testSmtpConnection = async (config, recipientEmail) => {
  if (!config || !config.smtpHost || !config.smtpUser || !config.smtpPass) {
    throw new Error('Host, Username, and Password are required to test SMTP connection.');
  }

  const port = parseInt(config.smtpPort || '587', 10);
  const secure = port === 465 || config.secure === true || config.secure === 'true';

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: port,
    secure: secure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // 1. Verify connection credentials
  await transporter.verify();

  // 2. Dispatch a verification email
  const targetEmail = recipientEmail || config.smtpUser;
  const fromAddress = config.fromEmail 
    ? `"${config.fromName || 'Clinic Admin'}" <${config.fromEmail}>`
    : `"${config.fromName || 'Clinic Admin'}" <${config.smtpUser}>`;

  const info = await transporter.sendMail({
    from: fromAddress,
    to: targetEmail,
    subject: `[Verified] Clinic Email SMTP Connection Test - ${new Date().toLocaleTimeString()}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
        <div style="background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 24px; border-radius: 12px; color: white; text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 20px;">Clinic Email SMTP Verified</h2>
          <p style="margin: 6px 0 0; opacity: 0.9; font-size: 13px;">Dedicated Tenant Outbound Mail Gateway</p>
        </div>
        <p style="font-size: 14px; color: #334155; line-height: 1.6;">
          Congratulations! Your custom Clinic Email SMTP configuration has been successfully tested and verified.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; border-radius: 8px; overflow: hidden; font-size: 13px;">
          <tr><td style="padding: 10px 14px; font-weight: bold; color: #64748b;">SMTP Host</td><td style="padding: 10px 14px; color: #0f172a;">${config.smtpHost}</td></tr>
          <tr><td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Port & Security</td><td style="padding: 10px 14px; color: #0f172a;">${port} (${secure ? 'SSL/TLS' : 'STARTTLS'})</td></tr>
          <tr><td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Sender Email</td><td style="padding: 10px 14px; color: #0f172a;">${config.fromEmail || config.smtpUser}</td></tr>
          <tr><td style="padding: 10px 14px; font-weight: bold; color: #64748b;">Sender Name</td><td style="padding: 10px 14px; color: #0f172a;">${config.fromName || 'Clinic Admin'}</td></tr>
        </table>
        <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
          🔒 This configuration is securely stored for your clinic workspace and operates independently from system superadmin credentials.
        </p>
      </div>
    `
  });

  return {
    success: true,
    messageId: info.messageId,
    message: `SMTP connection verified and test email sent to ${targetEmail}!`
  };
};

module.exports = {
  getTenantSmtpConfig,
  createTenantTransporter,
  testSmtpConnection
};
