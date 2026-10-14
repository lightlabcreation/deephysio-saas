const express = require('express');
const cors = require('cors');

// Fix for Prisma BigInt serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const { verifyToken } = require('./modules/auth/auth.middleware');
const { requireModuleAccess } = require('./modules/auth/moduleAccess.middleware');
const app = express();

// Core Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'http://deephysiosoftware.kiaansoftware.com',
  'https://deephysiosoftware.kiaansoftware.com',
  'https://deephysioclinic.netlify.app',
  'https://clinicpilotdemo.store',
  'http://clinicpilotdemo.store',
  'https://api-saas.clinicpilotdemo.store',
  'http://api-saas.clinicpilotdemo.store',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Safely allow all origins or verified origins without throwing unhandled exceptions
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// 3. ROOT & HEALTH TEST ROUTES (Reverse Proxies & Uptime)
app.get('/', (req, res) => {
  res.send('SERVER OK');
});

app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'ClinicPilot Clinical SaaS API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'ClinicPilot API',
    uptime: process.uptime()
  });
});

// 🔥 Response Transformer (BEFORE routes)
const responseTransformer = require('./utils/responseTransformer');
app.use(responseTransformer);

// Routes
const authRoutes = require('./modules/auth/auth.routes');
app.use('/api/auth', authRoutes);

const saasRoutes = require('./modules/saas.routes');
app.use('/api/saas', saasRoutes);

const backupRoutes = require('./modules/backup/backup.routes');
app.use('/api/backup', backupRoutes);
app.use('/api/backups', backupRoutes);

const auditLogRoutes = require('./modules/auditLog/auditLog.routes');
app.use('/api/audit-logs', auditLogRoutes);

const supportRoutes = require('./modules/support/support.routes');
app.use('/api/support', supportRoutes);

const emailSettingsRoutes = require('./modules/emailSettings/emailSettings.routes');
app.use('/api/email-settings', emailSettingsRoutes);

// Mobile Device Push Token Registration
app.post('/api/notifications/register-device', require('./modules/auth/auth.controller').registerDeviceToken);

// Public Configuration Route
app.get('/api/public/config', async (req, res, next) => {
  try {
    const prisma = require('./config/prisma');
    let tenantId = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        tenantId = decoded.tenant_id !== undefined ? decoded.tenant_id : decoded.tenantId;
      } catch (e) {
        // invalid token ignored for public route
      }
    }

    const whereClause = {
      key: { in: ['clinicProfile', 'clinicCurrency'] }
    };

    if (tenantId) {
      whereClause.tenant_id = parseInt(tenantId, 10);
    } else {
      whereClause.tenant_id = null;
    }

    const settings = await prisma.globalSettings.findMany({
      where: whereClause
    });

    const data = {
      clinicProfile: null,
      clinicCurrency: null
    };

    settings.forEach((s) => {
      let val = s.value;
      try {
        if (val && typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          val = JSON.parse(val);
        }
      } catch (e) {}
      data[s.key] = val;
    });

    // If tenant is authenticated, ensure clinicName reflects their tenant organization
    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: parseInt(tenantId, 10) }
      });
      if (tenant && tenant.clinic_name) {
        data.clinicProfile = {
          ...(data.clinicProfile || {}),
          clinicName: (data.clinicProfile && data.clinicProfile.clinicName) ? data.clinicProfile.clinicName : tenant.clinic_name
        };
      }
    }

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

const testRoutes = require('./modules/test/test.routes');
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/test', testRoutes);
}

const userRoutes = require('./modules/user/user.routes');
const { getMe } = require('./modules/user/user.controller');
// /me endpoint: any authenticated user can fetch their own profile (no module guard)
app.get('/api/users/me', verifyToken, getMe);
// All other user management routes require Settings module access
app.use('/api/users', verifyToken, requireModuleAccess('Settings'), userRoutes);

const patientRoutes = require('./modules/patient/patient.routes');
app.use('/api/patients', verifyToken, requireModuleAccess('Patients'), patientRoutes);

const checkinRoutes = require('./modules/checkin/checkin.routes');
app.use('/api/checkin', verifyToken, requireModuleAccess('Appointments'), checkinRoutes);

const appointmentRoutes = require('./modules/appointment/appointment.routes');
app.use('/api/appointments', verifyToken, requireModuleAccess('Appointments'), appointmentRoutes);

const waitlistRoutes = require('./modules/waitlist/waitlist.routes');
app.use('/api/waitlist', verifyToken, requireModuleAccess('Appointments'), waitlistRoutes);


const serviceRoutes = require('./modules/service/service.routes');
app.use('/api/services', verifyToken, requireModuleAccess(['Billing', 'Appointments']), serviceRoutes);

const clinicalNoteRoutes = require('./modules/clinicalNote/clinicalNote.routes');
app.use('/api/clinical-notes', verifyToken, requireModuleAccess('Clinical Notes'), clinicalNoteRoutes);

const invoiceRoutes = require('./modules/invoice/invoice.routes');
app.use('/api/invoices', verifyToken, requireModuleAccess('Billing'), invoiceRoutes);

const paymentRoutes = require('./modules/payment/payment.routes');
app.use('/api/payments', verifyToken, requireModuleAccess('Billing'), paymentRoutes);

const formTemplateRoutes = require('./modules/formTemplate/formTemplate.routes');
app.use('/api/form-templates', verifyToken, requireModuleAccess('Forms'), formTemplateRoutes);

const formSubmissionRoutes = require('./modules/formSubmission/formSubmission.routes');
app.use('/api/form-submissions', verifyToken, requireModuleAccess('Forms'), formSubmissionRoutes);

const attachmentRoutes = require('./modules/attachment/attachment.routes');
app.use('/api/attachments', verifyToken, requireModuleAccess('Clinical Notes'), attachmentRoutes);

const taskRoutes = require('./modules/task/task.routes');
app.use('/api/tasks', verifyToken, requireModuleAccess('Patients'), taskRoutes);

const fileRoutes = require('./modules/file/file.routes');
app.use('/api/files', verifyToken, requireModuleAccess('Patients'), fileRoutes);

const bodyChartRoutes = require('./modules/bodyChart/bodyChart.routes');
app.use('/api/body-charts', verifyToken, requireModuleAccess('Patients'), bodyChartRoutes);

const episodeRoutes = require('./modules/episode/episode.routes');
app.use('/api/episodes', verifyToken, requireModuleAccess('Patients'), episodeRoutes);

const clinicalHistoryRoutes = require('./modules/clinicalHistory/clinicalHistory.routes');
app.use('/api/clinical-history', verifyToken, requireModuleAccess('Patients'), clinicalHistoryRoutes);

const analyticsRoutes = require('./modules/analytics/analytics.routes');
app.use('/api/analytics', verifyToken, requireModuleAccess('Analytics'), analyticsRoutes);

const settingsRoutes = require('./modules/settings/settings.routes');
app.use('/api/settings', verifyToken, requireModuleAccess('Settings'), settingsRoutes);

const whatsappRoutes = require('./modules/whatsapp/whatsapp.routes');
app.use('/api/settings/whatsapp', verifyToken, requireModuleAccess('Settings'), whatsappRoutes);
app.use('/api/whatsapp', verifyToken, requireModuleAccess('Settings'), whatsappRoutes);

const noteTemplateRoutes = require('./modules/noteTemplate/noteTemplate.routes');
app.use('/api/note-templates', verifyToken, requireModuleAccess('Clinical Notes'), noteTemplateRoutes);

const communicationRoutes = require('./modules/communication/communication.routes');
app.use('/api/communication', verifyToken, requireModuleAccess('Communication'), communicationRoutes);

const integrationRoutes = require('./modules/integration/integration.routes');
app.use('/api/integrations', verifyToken, requireModuleAccess('Settings'), integrationRoutes);

// Error Handler (LAST)
const { errorHandler } = require('./middleware/error.middleware');
app.use(errorHandler);

module.exports = app;  
