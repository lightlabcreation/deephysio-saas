const prisma = require('../../config/prisma');
const whatsappService = require('./whatsapp.service');

/**
 * Helper to resolve Clinic Name from tenant
 */
const resolveClinicName = async (tenantId) => {
  if (!tenantId) return 'DeePhysio Healthcare';
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: parseInt(tenantId, 10) },
      select: { clinic_name: true }
    });
    return tenant?.clinic_name || 'DeePhysio Healthcare';
  } catch (_) {
    return 'DeePhysio Healthcare';
  }
};

/**
 * Helper to resolve Admin WhatsApp number for a tenant
 */
const resolveAdminWhatsAppNumber = async (tenantId) => {
  try {
    const tid = parseInt(tenantId, 10);
    const rows = await prisma.$queryRawUnsafe(
      "SELECT phone_number FROM whatsapp_connections WHERE tenant_id = ? AND status = 'CONNECTED' LIMIT 1",
      tid
    );
    if (rows && rows.length > 0 && rows[0].phone_number) {
      return rows[0].phone_number;
    }
  } catch (_) {}
  return null;
};

/**
 * 1. Attendance / Check-In Notification
 * Dispatches asynchronously to:
 * - Patient's WhatsApp number (Member)
 * - Admin's connected WhatsApp number (Admin Alert)
 */
const notifyAttendanceCheckin = async ({ tenantId, patient, appointment, therapistName }) => {
  setImmediate(async () => {
    try {
      const clinicName = await resolveClinicName(tenantId);
      const patientName = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || 'Patient';
      const patientPhone = patient?.phone;
      const checkinTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const checkinDate = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

      // 1. Send to Member (Patient)
      if (patientPhone) {
        const memberMsg = 
`*${clinicName}*

Hello *${patientName}*,

Your attendance has been marked successfully.

📅 Date: ${checkinDate}
⏰ Time: ${checkinTime}
🩺 Practitioner: ${therapistName || 'Clinic Staff'}
📍 Status: *Present (Checked-In)*

Thank you for visiting us.`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: patientPhone,
          recipientName: patientName,
          recipientType: 'PATIENT',
          eventType: 'ATTENDANCE_CHECKIN',
          messageText: memberMsg
        });
      }

      // 2. Send to Admin Alert
      const adminPhone = await resolveAdminWhatsAppNumber(tenantId);
      if (adminPhone) {
        const adminMsg = 
`*${clinicName}* — Admin Alert

🔔 *Patient Check-In Confirmed*
• Patient: *${patientName}*
• Phone: ${patientPhone || 'N/A'}
• Doctor: ${therapistName || 'General'}
• Time: ${checkinTime}
• Date: ${checkinDate}`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: adminPhone,
          recipientName: 'Clinic Administrator',
          recipientType: 'ADMIN',
          eventType: 'ADMIN_ALERT_CHECKIN',
          messageText: adminMsg
        });
      }
    } catch (err) {
      console.warn('[WhatsApp Notification] Error in attendance notification (non-blocking):', err.message);
    }
  });
};

/**
 * 2. New Appointment Booked Notification
 */
const notifyAppointmentBooking = async ({ tenantId, patient, appointment, therapistName, roomName, serviceName }) => {
  setImmediate(async () => {
    try {
      const clinicName = await resolveClinicName(tenantId);
      const patientName = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || 'Patient';
      const patientPhone = patient?.phone;
      const apptDate = appointment?.appointment_date 
        ? new Date(appointment.appointment_date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Scheduled Date';
      const apptTime = appointment?.start_time 
        ? new Date(appointment.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '';

      // Member Message
      if (patientPhone) {
        const memberMsg = 
`*${clinicName}*

Hello *${patientName}*,

Your appointment has been confirmed!

📅 Date: ${apptDate} ${apptTime ? `at ${apptTime}` : ''}
🩺 Practitioner: ${therapistName || 'Clinic Doctor'}
🏷️ Service: ${serviceName || 'Consultation'}
🚪 Room: ${roomName || 'Clinic Room'}

Please arrive 5-10 minutes prior to your slot.
Thank you.`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: patientPhone,
          recipientName: patientName,
          recipientType: 'PATIENT',
          eventType: 'APPOINTMENT_BOOKED',
          messageText: memberMsg
        });
      }

      // Admin Message
      const adminPhone = await resolveAdminWhatsAppNumber(tenantId);
      if (adminPhone) {
        const adminMsg = 
`*${clinicName}* — Admin Notification

📅 *New Appointment Scheduled*
• Patient: *${patientName}* (${patientPhone || 'No Phone'})
• Practitioner: ${therapistName || 'Assigned'}
• Date & Time: ${apptDate} ${apptTime}
• Room: ${roomName || 'Standard'}`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: adminPhone,
          recipientName: 'Clinic Administrator',
          recipientType: 'ADMIN',
          eventType: 'ADMIN_ALERT_APPOINTMENT',
          messageText: adminMsg
        });
      }
    } catch (err) {
      console.warn('[WhatsApp Notification] Error in appointment booking notification:', err.message);
    }
  });
};

/**
 * 3. Payment Received Notification
 */
const notifyPaymentReceived = async ({ tenantId, patient, amount, currencySymbol = '₹', invoiceNumber, paymentMethod }) => {
  setImmediate(async () => {
    try {
      const clinicName = await resolveClinicName(tenantId);
      const patientName = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || 'Patient';
      const patientPhone = patient?.phone;
      const formattedAmount = `${currencySymbol}${parseFloat(amount || 0).toFixed(2)}`;

      if (patientPhone) {
        const memberMsg = 
`*${clinicName}*

Hello *${patientName}*,

We have successfully received your payment of *${formattedAmount}*.

📄 Invoice: #${invoiceNumber || 'INV-001'}
💳 Mode: ${paymentMethod || 'Online / Cash'}
📅 Date: ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}

Thank you for choosing ${clinicName}!`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: patientPhone,
          recipientName: patientName,
          recipientType: 'PATIENT',
          eventType: 'PAYMENT_RECEIVED',
          messageText: memberMsg
        });
      }
    } catch (err) {
      console.warn('[WhatsApp Notification] Error in payment notification:', err.message);
    }
  });
};

/**
 * 4. Clinical Plan / Exercises / Diet Update Notification
 */
const notifyClinicalPlanUpdated = async ({ tenantId, patient, planTitle, planType = 'Treatment & Exercise' }) => {
  setImmediate(async () => {
    try {
      const clinicName = await resolveClinicName(tenantId);
      const patientName = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim() || 'Patient';
      const patientPhone = patient?.phone;

      if (patientPhone) {
        const memberMsg = 
`*${clinicName}*

Hello *${patientName}*,

Your ${planType} plan has been updated by your practitioner.

📋 Plan: *${planTitle || 'Home Exercise & Care Routine'}*
📅 Updated: ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}

Please follow the prescribed guidance. For any queries, contact our clinic.
Thank you.`;

        await whatsappService.sendWhatsAppMessage({
          tenantId,
          recipientPhone: patientPhone,
          recipientName: patientName,
          recipientType: 'PATIENT',
          eventType: 'EXERCISE_DIET_PLAN',
          messageText: memberMsg
        });
      }
    } catch (err) {
      console.warn('[WhatsApp Notification] Error in plan update notification:', err.message);
    }
  });
};

module.exports = {
  notifyAttendanceCheckin,
  notifyAppointmentBooking,
  notifyPaymentReceived,
  notifyClinicalPlanUpdated
};
