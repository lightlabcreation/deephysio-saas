const prisma = require('../../config/prisma');

/**
 * Get all waitlist entries
 * @param {Number} [tenantId] - Optional tenant context
 * @returns {Promise<Array>} List of waitlist entries
 */
const getAllEntries = async (tenantId) => {
  const where = {};
  if (tenantId) where.tenant_id = tenantId;

  return await prisma.waitlist.findMany({
    where,
    orderBy: {
      created_at: 'desc'
    }
  });
};

/**
 * Create a new waitlist entry
 * @param {Object} data - Formatted data object
 * @param {Number} [tenantId] - Optional tenant context
 * @returns {Promise<Object>} Created entry
 */
const createEntry = async (data, tenantId) => {
  const { 
    firstName,
    lastName,
    service, 
    preferredDate, 
    preferredTime, 
    contactNumber, 
    priority 
  } = data;

  // 1. Phone Normalization (MANDATORY)
  const normalizedPhone = contactNumber.trim();

  // 2. Check if patient already exists within this tenant
  const patientWhere = { 
    phone: normalizedPhone,
    is_deleted: false 
  };
  if (tenantId) patientWhere.tenant_id = tenantId;

  let patient = await prisma.patient.findFirst({
    where: patientWhere
  });

  // 3. IF patient doesn't exist, create one under this tenant
  if (!patient) {
    patient = await prisma.patient.create({
      data: {
        first_name: firstName,
        last_name: lastName,
        phone: normalizedPhone,
        patient_type: 'Normal',
        behaviour: 'green',
        tenant_id: tenantId || null
      }
    });
  }

  // 4. Create Waitlist Entry with patient relation
  return await prisma.waitlist.create({
    data: {
      patient_id: patient.id,
      first_name: firstName,
      last_name: lastName,
      service: service,
      preferred_date: preferredDate ? new Date(preferredDate) : null,
      preferred_time: preferredTime || null,
      contact_number: normalizedPhone,
      priority: priority || 'MEDIUM',
      status: 'WAITING',
      tenant_id: tenantId || null
    }
  });
};

/**
 * Delete a waitlist entry by ID
 * @param {number} id - The ID of the entry to delete
 * @param {number} [tenantId] - Optional tenant context
 * @returns {Promise<Object>} Deleted entry
 */
const deleteEntry = async (id, tenantId) => {
  const wid = parseInt(id, 10);
  const where = { id: wid };
  if (tenantId) where.tenant_id = tenantId;

  const existingEntry = await prisma.waitlist.findFirst({
    where
  });

  if (!existingEntry) {
    const error = new Error('Waitlist entry not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.waitlist.delete({
    where: { id: wid }
  });
};

/**
 * Convert a waitlist entry to an appointment
 * @param {number} waitlistId - ID of the waitlist entry
 * @param {Object} conversionData - Data from the frontend
 * @param {number} [tenantId] - Optional tenant context
 * @returns {Promise<Object>} Created appointment
 */
const convertToAppointment = async (waitlistId, conversionData, tenantId) => {
  const wid = parseInt(waitlistId, 10);
  const where = { id: wid };
  if (tenantId) where.tenant_id = tenantId;

  const waitlistEntry = await prisma.waitlist.findFirst({
    where,
    include: { patient: true }
  });

  if (!waitlistEntry) {
    const error = new Error('Waitlist entry not found');
    error.statusCode = 404;
    throw error;
  }

  const { therapistId, appointmentDate, serviceId, room, startTime, endTime, notes } = conversionData;

  // 1. Verify Therapist belongs to this tenant
  const therapistWhere = { id: parseInt(therapistId, 10) };
  if (tenantId) therapistWhere.tenant_id = tenantId;
  const therapist = await prisma.user.findFirst({ where: therapistWhere });
  if (!therapist || (therapist.role !== 'therapist' && therapist.role !== 'admin')) {
    const error = new Error('Therapist not found or invalid');
    error.statusCode = 400;
    throw error;
  }

  // 2. Create the Appointment
  const appointment = await prisma.appointment.create({
    data: {
      patient_id: waitlistEntry.patient_id,
      therapist_id: parseInt(therapistId, 10),
      appointment_date: new Date(appointmentDate),
      service_id: serviceId ? parseInt(serviceId, 10) : null,
      room: room || null,
      start_time: startTime ? new Date(startTime) : null,
      end_time: endTime ? new Date(endTime) : null,
      notes: notes || `Converted from waitlist (Service: ${waitlistEntry.service})`,
      status: 'scheduled',
      tenant_id: tenantId || null
    }
  });

  // 3. Mark the Waitlist Entry as CONFIRMED
  await prisma.waitlist.update({
    where: { id: wid },
    data: { status: 'CONFIRMED' }
  });

  return appointment;
};

module.exports = {
  getAllEntries,
  createEntry,
  deleteEntry,
  convertToAppointment
};
