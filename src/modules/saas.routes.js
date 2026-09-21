const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth/auth.middleware');
const saasState = require('../config/saasState');

router.get('/revenue', verifyToken, (req, res) => {
  return res.status(200).json({
    success: true,
    data: saasState.getRevenueStats()
  });
});

router.get('/payments', verifyToken, (req, res) => {
  return res.status(200).json({
    success: true,
    data: saasState.getPayments()
  });
});

router.get('/tenants', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const tenants = await prisma.tenant.findMany({
      include: {
        users: {
          where: { role: 'admin' },
          take: 1
        }
      },
      orderBy: { created_at: 'desc' }
    });

    const mappedTenants = tenants.map(t => {
      const admin = t.users[0] || {};
      const expiry = new Date(new Date(t.created_at).setFullYear(new Date(t.created_at).getFullYear() + 1)).toISOString();
      return {
        id: t.id,
        name: admin.name || t.clinic_name || 'Admin User',
        email: admin.email || t.email,
        plan: t.plan || 'Starter',
        expiry_date: expiry,
        expiryDate: expiry,
        clinic_name: t.clinic_name || 'DeePhysio Clinic',
        clinicName: t.clinic_name || 'DeePhysio Clinic',
        subscription_status: t.subscription_status || 'active',
        subscriptionStatus: t.subscription_status || 'active',
        phone: admin.phone || 'N/A',
        created_at: t.created_at,
        createdAt: t.created_at
      };
    });

    return res.status(200).json({
      success: true,
      data: mappedTenants
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

let mockSettings = {
  profile: { name: 'Super Admin', email: 'superadmin@deephysio.com', photo: '' },
  business: { businessName: 'DeePhysio Global', gstNumber: '29ABCDE1234F2Z5', mobileNumber: '+91 9876543210', businessAddress: 'Bangalore, India' },
  notifications: {}
};

router.get('/settings', verifyToken, (req, res) => {
  return res.status(200).json({ success: true, data: mockSettings });
});

router.put('/settings', verifyToken, (req, res) => {
  if (req.body.profile) mockSettings.profile = { ...mockSettings.profile, ...req.body.profile };
  if (req.body.business) mockSettings.business = { ...mockSettings.business, ...req.body.business };
  if (req.body.notifications) mockSettings.notifications = { ...mockSettings.notifications, ...req.body.notifications };
  
  return res.status(200).json({ success: true, message: 'Settings updated successfully' });
});

router.put('/settings/password', verifyToken, (req, res) => {
  return res.status(200).json({ success: true, message: 'Password updated successfully' });
});

router.patch('/tenants/:id/status', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const { status } = req.body;
    const tenantId = parseInt(req.params.id, 10);
    
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { subscription_status: String(status).toLowerCase() }
    });
    
    return res.status(200).json({ success: true, message: 'Status updated successfully', data: updated });
  } catch (error) {
    console.error('Error updating tenant status:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/tenants/:id', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const tenantId = parseInt(req.params.id, 10);
    
    // Clean up dependent models in order
    await prisma.invoiceItem.deleteMany({ where: { invoice: { tenant_id: tenantId } } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.appointment.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.clinicalNote.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.bodyChart.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.attachment.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.file.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.task.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.episode.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.waitlist.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.formSubmission.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.formTemplate.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.service.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.patientMedicalHistory.deleteMany({ where: { patient: { tenant_id: tenantId } } }).catch(() => {});
    await prisma.patientEmergencyContact.deleteMany({ where: { patient: { tenant_id: tenantId } } }).catch(() => {});
    await prisma.patient.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.clinicIntegration.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.systemActivityLog.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.reminderRule.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.globalSettings.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.clinicalNoteTemplate.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { tenant_id: tenantId } }).catch(() => {});
    
    await prisma.tenant.delete({
      where: { id: tenantId }
    });
    
    return res.status(200).json({ success: true, message: 'Tenant and all clinic data deleted successfully' });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/support', verifyToken, (req, res) => {
  const supportRoutes = require('./support/support.routes');
  return res.status(200).json({
    success: true,
    data: [
      {
        id: 101,
        subject: 'Billing Invoice PDF Generation Issue',
        message: 'When downloading GST invoice from billing section, the tax breakdown table format is misaligned on A4 print.',
        status: 'Open',
        priority: 'High',
        tenant_id: 1,
        tenant_name: 'Dr. Sharma Physiotherapy & Rehab',
        user_name: 'Dr. Sharma',
        user_email: 'sharma.clinic@gmail.com',
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        replies: []
      }
    ]
  });
});

module.exports = router;

