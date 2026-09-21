const express = require('express');
const router = express.Router();
const prisma = require('../../config/prisma');
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');
const { updateSettingsSchema } = require('./settings.validation');

// GET settings by keys
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const keysStr = req.query.keys;
    let settings;

    if (!keysStr) {
      settings = await prisma.globalSettings.findMany();
    } else {
      const keys = keysStr.split(',');
      settings = await prisma.globalSettings.findMany({
        where: { key: { in: keys } }
      });
    }

    const settingsMap = {};
    settings.forEach(s => { 
      try {
        // Try to parse JSON if it looks like an object/array
        if (s.value && (s.value.startsWith('{') || s.value.startsWith('['))) {
          settingsMap[s.key] = JSON.parse(s.value);
        } else {
          settingsMap[s.key] = s.value;
        }
      } catch (e) {
        settingsMap[s.key] = s.value;
      }
    });

    res.json({ success: true, data: settingsMap });
  } catch (error) {
    next(error);
  }
});

// POST update settings
router.post('/', verifyToken, authorizeRoles('admin', 'therapist', 'receptionist', 'billing'), async (req, res, next) => {
  try {
    const { error, value } = updateSettingsSchema.validate(req.body, { abortEarly: false });
    
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details.map(d => d.message).join(', ') 
      });
    }

    const { settings } = value;

    // MySQL unique on `key` is case-insensitive (unicode_ci): duplicate casing in one payload
    // or concurrent upserts can throw P2002. Merge by lowercase key; first casing wins.
    const byCanonical = new Map();
    for (const [rawKey, val] of Object.entries(settings)) {
      const key = String(rawKey).trim();
      if (!key) continue;
      const canon = key.toLowerCase();
      if (!byCanonical.has(canon)) byCanonical.set(canon, { key, val });
    }

    await prisma.$transaction(async (tx) => {
      for (const { key, val } of byCanonical.values()) {
        const dbValue = (typeof val === 'object' && val !== null) ? JSON.stringify(val) : String(val);
        await tx.$executeRaw`
          INSERT INTO \`global_settings\` (\`key\`, \`value\`, \`updated_at\`)
          VALUES (${key}, ${dbValue}, NOW(3))
          ON DUPLICATE KEY UPDATE
            \`value\` = VALUES(\`value\`),
            \`updated_at\` = VALUES(\`updated_at\`)
        `;
      }
    });

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
