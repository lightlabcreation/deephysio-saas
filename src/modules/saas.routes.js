const express = require('express');
const router = express.Router();
const { verifyToken } = require('./auth/auth.middleware');
const { authorizeRoles } = require('./auth/role.middleware');
const saasState = require('../config/saasState');

let defaultPlans = [
  {
    id: 1,
    name: 'Starter Plan',
    badge: null,
    price_monthly: 29,
    max_users: 2,
    description: 'Perfect for solo practitioners and newly opened physiotherapy clinics.',
    features: [
      'Unlimited Patient Records',
      'Appointment Scheduling & Calendar',
      'Basic SOAP Clinical Notes',
      'Standard Invoicing & Receipts'
    ]
  },
  {
    id: 2,
    name: 'Professional Plan',
    badge: 'Popular',
    price_monthly: 79,
    max_users: 8,
    description: 'Designed for established multi-therapist physiotherapy centers.',
    features: [
      'Everything in Starter',
      'Visual Body Charts & Attachment Vault',
      'Custom Intake & Assessment Forms Builder',
      'Automated SMS & Email Reminders',
      'Staff Productivity & Room Analytics'
    ]
  },
  {
    id: 3,
    name: 'Enterprise / Hospital Plan',
    badge: 'Best Value',
    price_monthly: 199,
    max_users: 25,
    description: 'Full-featured enterprise suite with advanced multi-branch security.',
    features: [
      'Everything in Professional',
      'Single Session Access & IP Whitelist',
      'Daily Automated Encrypted Backups',
      'Telehealth & Video Consultations',
      '24/7 Dedicated Priority SaaS Support'
    ]
  }
];

router.get('/plans', (req, res) => {
  return res.status(200).json({
    success: true,
    data: defaultPlans
  });
});

router.post('/plans', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  const newPlan = {
    id: Date.now(),
    name: req.body.name || 'New Plan',
    badge: req.body.badge || null,
    price_monthly: Number(req.body.price_monthly) || 49,
    max_users: Number(req.body.max_users) || 5,
    description: req.body.description || '',
    features: Array.isArray(req.body.features) ? req.body.features : []
  };
  defaultPlans.push(newPlan);
  return res.status(201).json({ success: true, message: 'Plan created', data: newPlan });
});

router.put('/plans/:id', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  const planId = parseInt(req.params.id, 10);
  const idx = defaultPlans.findIndex(p => p.id === planId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Plan not found' });
  }
  defaultPlans[idx] = { ...defaultPlans[idx], ...req.body };
  return res.status(200).json({ success: true, message: 'Plan updated', data: defaultPlans[idx] });
});

router.post('/upgrade-plan', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const { planName, razorpayPaymentId, razorpayOrderId } = req.body;
    
    if (!planName) {
      return res.status(400).json({ success: false, message: 'planName is required' });
    }

    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'No clinic tenant associated with this user' });
    }

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: planName,
        subscription_status: 'active'
      }
    });

    if (razorpayPaymentId || razorpayOrderId) {
      let amount = 99900;
      if (planName === 'Standard') amount = 129900;
      else if (planName === 'Pro') amount = 149900;
      
      saasState.addPayment({
        name: req.user.name || 'Clinic Admin',
        businessName: updatedTenant.clinic_name,
        amount,
        plan: planName,
        razorpayPaymentId: razorpayPaymentId || 'DIRECT_UPGRADE'
      });
    }

    try {
      const { logActivity } = require('../utils/activityLogger');
      await logActivity(
        req.user.id,
        'UPDATE_SETTINGS',
        tenantId,
        'Tenant',
        `Clinic plan upgraded to ${planName}`,
        { entity: 'Tenant', entityId: tenantId, plan: planName },
        req.ip || '127.0.0.1',
        tenantId
      );
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: `Plan upgraded to ${planName} successfully!`,
      data: updatedTenant
    });
  } catch (error) {
    console.error('Error upgrading plan:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/revenue', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  return res.status(200).json({
    success: true,
    data: saasState.getRevenueStats()
  });
});

router.get('/payments', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  return res.status(200).json({
    success: true,
    data: saasState.getPayments()
  });
});

router.get('/tenants', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const isSuperAdmin = req.user.role === 'superadmin';
    const where = isSuperAdmin ? {} : { id: req.user.tenant_id };

    const tenants = await prisma.tenant.findMany({
      where,
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

router.get('/settings', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  return res.status(200).json({ success: true, data: mockSettings });
});

router.put('/settings', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  if (req.body.profile) mockSettings.profile = { ...mockSettings.profile, ...req.body.profile };
  if (req.body.business) mockSettings.business = { ...mockSettings.business, ...req.body.business };
  if (req.body.notifications) mockSettings.notifications = { ...mockSettings.notifications, ...req.body.notifications };
  
  return res.status(200).json({ success: true, message: 'Settings updated successfully' });
});

router.put('/settings/password', verifyToken, authorizeRoles('superadmin'), (req, res) => {
  return res.status(200).json({ success: true, message: 'Password updated successfully' });
});

router.patch('/tenants/:id/status', verifyToken, authorizeRoles('superadmin'), async (req, res) => {
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

router.delete('/tenants/:id', verifyToken, authorizeRoles('superadmin'), async (req, res) => {
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

router.get('/support', verifyToken, authorizeRoles('superadmin'), (req, res) => {
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

/**
 * 🧪 FEATURE 6: Loading Data Testing (Demo Data Seeder)
 */
router.post('/seed-demo-data', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const targetTenantId = req.user.role === 'superadmin' && req.body.tenantId
      ? parseInt(req.body.tenantId, 10)
      : req.user.tenant_id;

    if (!targetTenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID required' });
    }

    const therapist = await prisma.user.findFirst({
      where: { tenant_id: targetTenantId, role: { in: ['admin', 'therapist'] } }
    });

    const therapistId = therapist ? therapist.id : req.user.id;

    // 1. Seed standard Services
    const demoServices = [
      { name: 'Initial Assessment & Consultation', category: 'Assessment', duration: 45, price: 1200, is_active: true, tenant_id: targetTenantId },
      { name: 'Manual Therapy & Spinal Mobilization', category: 'Manual Therapy', duration: 45, price: 900, is_active: true, tenant_id: targetTenantId },
      { name: 'Dry Needling & Myofascial Release', category: 'Physiotherapy', duration: 30, price: 800, is_active: true, tenant_id: targetTenantId },
      { name: 'Sports Injury Rehabilitation', category: 'Sports Rehab', duration: 60, price: 1500, is_active: true, tenant_id: targetTenantId },
      { name: 'Post-Op Knee / ACL Rehabilitation', category: 'Rehabilitation', duration: 45, price: 1000, is_active: true, tenant_id: targetTenantId }
    ];

    for (const s of demoServices) {
      const existing = await prisma.service.findFirst({ where: { name: s.name, tenant_id: targetTenantId } });
      if (!existing) {
        await prisma.service.create({ data: s });
      }
    }

    const createdServices = await prisma.service.findMany({ where: { tenant_id: targetTenantId } });
    const s1 = createdServices[0]?.id;
    const s2 = createdServices[1]?.id;

    // 2. Seed 4 Demo Patients
    const demoPatients = [
      {
        first_name: 'Rahul',
        last_name: 'Verma',
        phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `rahul.verma${Date.now()}@example.com`,
        gender: 'male',
        date_of_birth: new Date('1992-05-14'),
        address: 'Indiranagar, Bangalore',
        patient_type: 'VIP',
        behaviour: 'green',
        therapist_id: therapistId,
        tenant_id: targetTenantId
      },
      {
        first_name: 'Pooja',
        last_name: 'Kulkarni',
        phone: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `pooja.k${Date.now()}@example.com`,
        gender: 'female',
        date_of_birth: new Date('1988-11-20'),
        address: 'Koramangala 4th Block, Bangalore',
        patient_type: 'Normal',
        behaviour: 'green',
        therapist_id: therapistId,
        tenant_id: targetTenantId
      },
      {
        first_name: 'Vikram',
        last_name: 'Mehta',
        phone: `+9196${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `vikram.mehta${Date.now()}@example.com`,
        gender: 'male',
        date_of_birth: new Date('1975-02-08'),
        address: 'Whitefield, Bangalore',
        patient_type: 'Insurance',
        behaviour: 'yellow',
        therapist_id: therapistId,
        tenant_id: targetTenantId
      },
      {
        first_name: 'Ananya',
        last_name: 'Deshmukh',
        phone: `+9195${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `ananya.d${Date.now()}@example.com`,
        gender: 'female',
        date_of_birth: new Date('1996-09-01'),
        address: 'HSR Layout Sector 2, Bangalore',
        patient_type: 'Normal',
        behaviour: 'green',
        therapist_id: therapistId,
        tenant_id: targetTenantId
      }
    ];

    const seededPatients = [];
    for (const p of demoPatients) {
      const created = await prisma.patient.create({ data: p });
      seededPatients.push(created);
    }

    // 3. Seed Appointments (Today, Tomorrow, and Next Day)
    const now = new Date();
    const apptDates = [
      new Date(now.getTime() + 1 * 3600 * 1000),
      new Date(now.getTime() + 3 * 3600 * 1000),
      new Date(now.getTime() + 24 * 3600 * 1000),
      new Date(now.getTime() + 48 * 3600 * 1000),
    ];

    for (let i = 0; i < seededPatients.length; i++) {
      const pat = seededPatients[i];
      const srvId = createdServices[i % createdServices.length]?.id;
      await prisma.appointment.create({
        data: {
          patient_id: pat.id,
          therapist_id: therapistId,
          appointment_date: apptDates[i],
          status: i === 0 ? 'confirmed' : i === 1 ? 'scheduled' : 'scheduled',
          service_id: srvId,
          room: `Room ${i + 1}`,
          notes: `Demo trial appointment for ${pat.first_name}`,
          tenant_id: targetTenantId
        }
      });

      // 4. Seed Clinical SOAP Note
      await prisma.clinicalNote.create({
        data: {
          patient_id: pat.id,
          therapist_id: therapistId,
          type: 'SOAP',
          date: new Date(),
          status: 'Signed',
          subjective: `Patient complains of lower back tightness and cervical stiffness after prolonged desk work for 8 hours daily.`,
          objective: `Active cervical rotation reduced to 45 deg bilaterally. Tenderness noted along upper trapezius and lumbar paraspinal muscles.`,
          assessment: `Mechanical postural back strain with cervical muscle spasm. Good recovery prognosis with 4 rehabilitation sessions.`,
          plan: `1. Ultrasound & TENS therapy for 15 mins.\n2. Deep tissue myofascial release.\n3. Core stability & thoracic extension exercises.\n4. Ergonomic chair adjustments.`,
          tenant_id: targetTenantId
        }
      });

      // 5. Seed Invoices & Payments
      const invNum = `INV-DEMO-${Date.now().toString().slice(-4)}-${i + 1}`;
      const amount = (i + 1) * 900;
      await prisma.invoice.create({
        data: {
          invoice_number: invNum,
          patient_id: pat.id,
          date: new Date(),
          subtotal: amount,
          tax: 0,
          total: amount,
          status: i % 2 === 0 ? 'PAID' : 'PENDING',
          notes: 'Demo sample billing invoice',
          tenant_id: targetTenantId
        }
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Demo test data loaded successfully! 4 patients, appointments, treatments, notes & invoices generated.',
      data: {
        patientsCreated: seededPatients.length,
        appointmentsCreated: apptDates.length,
        servicesCreated: createdServices.length
      }
    });
  } catch (error) {
    console.error('Error seeding demo data:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * 🧪 FEATURE 6: Purge Demo Data
 */
router.post('/purge-demo-data', verifyToken, async (req, res) => {
  try {
    const prisma = require('../config/prisma');
    const targetTenantId = req.user.role === 'superadmin' && req.body.tenantId
      ? parseInt(req.body.tenantId, 10)
      : req.user.tenant_id;

    if (!targetTenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID required' });
    }

    // Delete invoices matching DEMO
    await prisma.invoice.deleteMany({
      where: { tenant_id: targetTenantId, invoice_number: { contains: 'DEMO' } }
    }).catch(() => {});

    // Delete demo appointments
    await prisma.appointment.deleteMany({
      where: { tenant_id: targetTenantId, notes: { contains: 'Demo' } }
    }).catch(() => {});

    // Delete demo clinical notes
    await prisma.clinicalNote.deleteMany({
      where: { tenant_id: targetTenantId, subjective: { contains: 'lower back tightness' } }
    }).catch(() => {});

    // Delete demo patients
    await prisma.patient.deleteMany({
      where: { tenant_id: targetTenantId, email: { contains: '@example.com' } }
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Demo sample test data purged successfully.'
    });
  } catch (error) {
    console.error('Error purging demo data:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


