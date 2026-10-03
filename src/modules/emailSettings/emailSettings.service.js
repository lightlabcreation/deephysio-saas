const prisma = require('../../config/prisma');
const { encrypt, decrypt } = require('../../utils/cryptoHelper');
const { testSmtpConnection, createTenantTransporter } = require('../../utils/smtpHelper');
const { logActivity } = require('../../utils/activityLogger');

const getSettingKey = (tenantId) => tenantId ? `tenant_${tenantId}_smtp_config` : 'global_smtp_config';

/**
 * Detect provider from host or apiKey
 */
const detectProvider = (host = '', pass = '') => {
  const h = (host || '').toLowerCase();
  const p = (pass || '').toLowerCase();
  if (h.includes('gmail.com') || h.includes('google')) return 'gmail';
  if (h.includes('brevo.com') || h.includes('sendinblue') || p.startsWith('xkeysib-') || p.startsWith('xsmtpib-')) return 'brevo';
  if (h.includes('resend.com') || p.startsWith('re_')) return 'resend';
  return 'custom';
};

/**
 * Get Email SMTP Settings for a tenant or global system
 */
const getEmailSettings = async (tenantId = null) => {
  const tid = tenantId ? parseInt(tenantId, 10) : null;
  const settingKey = getSettingKey(tid);

  const record = await prisma.globalSettings.findFirst({
    where: { key: settingKey, tenant_id: tid }
  });

  if (!record || !record.value) {
    const envPass = process.env.SMTP_PASS || '';
    const hasEnvPass = Boolean(envPass && envPass !== 'your-app-password');
    return {
      hasCustomConfig: false,
      provider: detectProvider(process.env.SMTP_HOST || 'smtp.gmail.com', envPass),
      smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
      smtpPort: String(process.env.SMTP_PORT || '587'),
      smtpUser: process.env.SMTP_USER || '',
      smtpPass: hasEnvPass ? envPass : '',
      hasSavedPassword: hasEnvPass,
      fromEmail: process.env.SMTP_FROM || 'noreply@deephysio.com',
      fromName: 'DeePhysio Healthcare Platform',
      isSmtpActive: Boolean(hasEnvPass),
      secure: String(process.env.SMTP_PORT) === '465'
    };
  }

  try {
    const parsed = JSON.parse(record.value);
    const decryptedPass = parsed.smtpPass ? decrypt(parsed.smtpPass) : '';
    const provider = parsed.provider || detectProvider(parsed.smtpHost, decryptedPass);

    return {
      hasCustomConfig: true,
      provider,
      smtpHost: parsed.smtpHost || '',
      smtpPort: String(parsed.smtpPort || '587'),
      smtpUser: parsed.smtpUser || '',
      smtpPass: decryptedPass,
      hasSavedPassword: Boolean(decryptedPass),
      fromEmail: parsed.fromEmail || '',
      fromName: parsed.fromName || '',
      isSmtpActive: parsed.isSmtpActive !== false,
      secure: Boolean(parsed.secure),
      updatedAt: parsed.updatedAt || record.updated_at
    };
  } catch (err) {
    console.error('[EmailSettingsService] Parse error:', err.message);
    return {
      hasCustomConfig: false,
      provider: 'gmail',
      smtpHost: 'smtp.gmail.com',
      smtpPort: '587',
      smtpUser: '',
      smtpPass: '',
      hasSavedPassword: false,
      fromEmail: '',
      fromName: '',
      isSmtpActive: false,
      secure: false
    };
  }
};

/**
 * Save or Update Email SMTP Settings for a tenant or global system
 */
const saveEmailSettings = async (tenantId = null, payload, userId = null) => {
  const tid = tenantId ? parseInt(tenantId, 10) : null;

  const {
    provider,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
    isSmtpActive,
    secure
  } = payload;

  const detectedProv = provider || detectProvider(smtpHost, smtpPass);

  // If password was already saved and frontend sent empty or masked, preserve existing
  let finalPassword = smtpPass;
  if (!finalPassword || finalPassword === '••••••••••••••••') {
    const existing = await getEmailSettings(tid);
    finalPassword = existing.smtpPass;
  }

  if (!smtpHost && isSmtpActive) {
    throw new Error('SMTP Host is required when active.');
  }

  const encryptedPass = finalPassword ? encrypt(finalPassword) : '';

  const configData = {
    provider: detectedProv,
    smtpHost: (smtpHost || '').trim(),
    smtpPort: String(smtpPort || '587').trim(),
    smtpUser: (smtpUser || '').trim(),
    smtpPass: encryptedPass,
    fromEmail: (fromEmail || '').trim(),
    fromName: (fromName || '').trim(),
    isSmtpActive: isSmtpActive === undefined ? true : Boolean(isSmtpActive),
    secure: Boolean(secure || String(smtpPort) === '465'),
    updatedAt: new Date().toISOString()
  };

  const settingKey = getSettingKey(tid);
  const existing = await prisma.globalSettings.findFirst({
    where: { key: settingKey, tenant_id: tid }
  });

  if (existing) {
    await prisma.globalSettings.update({
      where: { id: existing.id },
      data: {
        value: JSON.stringify(configData),
        tenant_id: tid
      }
    });
  } else {
    await prisma.globalSettings.create({
      data: {
        key: settingKey,
        value: JSON.stringify(configData),
        tenant_id: tid
      }
    });
  }

  if (userId) {
    await logActivity(
      userId,
      'UPDATE',
      tid || 0,
      'EmailSettings',
      `Updated SMTP settings (Provider: ${detectedProv}, Host: ${smtpHost}, Active: ${configData.isSmtpActive})`,
      null,
      null,
      tid
    );
  }

  return {
    success: true,
    message: 'Email SMTP settings saved and activated successfully!',
    data: {
      ...configData,
      smtpPass: finalPassword,
      hasSavedPassword: Boolean(finalPassword)
    }
  };
};

/**
 * Remove Custom SMTP settings for a tenant or global system
 */
const removeEmailSettings = async (tenantId = null, userId = null) => {
  const tid = tenantId ? parseInt(tenantId, 10) : null;
  const settingKey = getSettingKey(tid);

  await prisma.globalSettings.deleteMany({
    where: { key: settingKey, tenant_id: tid }
  });

  if (userId) {
    await logActivity(
      userId,
      'DELETE',
      tid || 0,
      'EmailSettings',
      'Removed custom SMTP credentials. Reverted to default system mailer.',
      null,
      null,
      tid
    );
  }

  return {
    success: true,
    message: 'Custom SMTP credentials removed successfully. Reverted to system default mailer.'
  };
};

/**
 * Test Connection & send live test email
 */
const testConnection = async (tenantId = null, payload, userEmail = null) => {
  const tid = tenantId ? parseInt(tenantId, 10) : null;
  let {
    provider,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
    secure,
    recipientEmail
  } = payload;

  // If password omitted or masked, load existing saved password from DB
  if (!smtpPass || smtpPass === '••••••••••••••••') {
    const existing = await getEmailSettings(tid);
    if (existing?.smtpPass) {
      smtpPass = existing.smtpPass;
    }
  }

  if (!smtpHost) {
    throw new Error('SMTP Host is required for testing connection.');
  }
  if (!smtpUser && !smtpPass?.startsWith('xkeysib-')) {
    throw new Error('SMTP Username is required for testing connection.');
  }
  if (!smtpPass) {
    throw new Error('SMTP Password or API Key is required for testing connection.');
  }

  const targetEmail = recipientEmail || userEmail || fromEmail || smtpUser;
  if (!targetEmail || !targetEmail.includes('@')) {
    throw new Error('Please provide a valid recipient email address.');
  }

  // 1. Special Handling: Brevo REST API Key (xkeysib-...)
  if (smtpPass.startsWith('xkeysib-') || provider === 'brevo_api') {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': smtpPass,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: fromName || 'Clinic Admin',
            email: fromEmail || smtpUser || 'noreply@deephysio.com'
          },
          to: [{ email: targetEmail }],
          subject: `[Verified] Brevo API Email Test - ${new Date().toLocaleTimeString()}`,
          htmlContent: `
            <div style="font-family: sans-serif; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h2 style="color: #0b996f;">Brevo (Sendinblue) API Verified!</h2>
              <p>Your Brevo REST API connection has been successfully verified.</p>
              <p><strong>Recipient:</strong> ${targetEmail}</p>
            </div>
          `
        })
      });

      const resJson = await response.json();
      if (!response.ok) {
        throw new Error(resJson.message || 'Brevo API authentication failed.');
      }

      return {
        success: true,
        messageId: resJson.messageId,
        message: `Brevo API connection verified and test email sent to ${targetEmail}!`
      };
    } catch (apiErr) {
      throw new Error(`Brevo API Error: ${apiErr.message}`);
    }
  }

  // 2. Standard SMTP Relay (Gmail, Brevo SMTP xsmtpib-, Resend, Custom)
  const config = {
    provider: provider || detectProvider(smtpHost, smtpPass),
    smtpHost: (smtpHost || '').trim(),
    smtpPort: String(smtpPort || '587').trim(),
    smtpUser: (smtpUser || '').trim(),
    smtpPass: smtpPass || '',
    fromEmail: (fromEmail || '').trim(),
    fromName: (fromName || '').trim(),
    secure: Boolean(secure || String(smtpPort) === '465')
  };

  return await testSmtpConnection(config, targetEmail);
};

module.exports = {
  detectProvider,
  getEmailSettings,
  saveEmailSettings,
  removeEmailSettings,
  testConnection
};
