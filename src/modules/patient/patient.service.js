const prisma = require('../../config/prisma');

/**
 * Get all patients
 * @returns {Array} List of patients
 */
const patientBasicSelect = {
  id: true,
  first_name: true,
  last_name: true,
  phone: true,
  date_of_birth: true,
  patient_type: true,
  behaviour: true,
  therapist_id: true,
  is_active: true
};

const getAllPatients = async (tenantId, scope = 'read', search) => {
  const where = { is_deleted: false, tenant_id: tenantId || null };
  if (search && String(search).trim()) {
    const term = String(search).trim();
    where.OR = [
      { first_name: { contains: term } },
      { last_name: { contains: term } },
      { phone: { contains: term } },
      { email: { contains: term } }
    ];
  }
  return prisma.patient.findMany({
    where,
    ...(scope === 'basic' ? { select: patientBasicSelect } : {}),
    orderBy: { created_at: 'desc' }
  });
};

/**
 * Create a new patient
 * @param {Object} patientData
 * @returns {Object} Created patient
 */
const createPatient = async (patientData, tenantId) => {
  const firstName = patientData.firstName || patientData.first_name || '';
  const lastName = patientData.lastName || patientData.last_name || '';
  const phone = patientData.phone || '';
  const email = patientData.email || '';
  const gender = patientData.gender || 'male';
  const rawDob = patientData.dateOfBirth || patientData.date_of_birth;
  const address = patientData.address || '';
  const patientType = patientData.patientType || patientData.patient_type || 'Normal';
  const behaviour = patientData.behaviour || 'green';
  const therapistId = patientData.therapistId || patientData.therapist_id;
  const emergencyContact = patientData.emergencyContact || (patientData.emergency_contacts && patientData.emergency_contacts[0]) || null;

  // Check duplicate phone
  const existingPhone = await prisma.patient.findFirst({
    where: { phone: phone.trim(), tenant_id: tenantId || null }
  });

  if (existingPhone) {
    const error = new Error('Patient with this phone number already exists');
    error.statusCode = 400;
    throw error;
  }

  // Check duplicate email (if provided)
  if (email && email.trim()) {
    const existingEmail = await prisma.patient.findFirst({
      where: { email: email.trim().toLowerCase(), tenant_id: tenantId || null }
    });

    if (existingEmail) {
      const error = new Error('Patient with this email already exists');
      error.statusCode = 400;
      throw error;
    }
  }

  // Parse Date of Birth safely
  let parsedDob = null;
  if (rawDob) {
    let d = null;
    if (rawDob instanceof Date && !isNaN(rawDob.getTime())) {
      d = rawDob;
    } else if (typeof rawDob === 'string') {
      const trimmed = rawDob.trim();
      // Check if format is DD/MM/YYYY or DD-MM-YYYY
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(trimmed)) {
        const parts = trimmed.split(/[\/\-]/);
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        d = new Date(year, month, day);
      } else {
        d = new Date(trimmed);
      }
    }
    if (d && !isNaN(d.getTime())) {
      const year = d.getFullYear();
      if (year >= 1900 && year <= 2100) {
        parsedDob = d;
      }
    }
  }

  const emergencyName = String(emergencyContact?.name || '').trim();
  const emergencyPhone = String(emergencyContact?.phone || '').trim();
  const emergencyRelation = String(emergencyContact?.relation || '').trim();

  // Create patient + optional emergency contact atomically
  const patient = await prisma.$transaction(async (tx) => {
    const createdPatient = await tx.patient.create({
      data: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        email: email ? email.trim().toLowerCase() : null,
        gender,
        date_of_birth: parsedDob,
        address: address ? address.trim() : null,
        patient_type: patientType || 'Normal',
        behaviour: behaviour || 'green',
        therapist_id: therapistId || null,
        tenant_id: tenantId || null
      }
    });

    if (emergencyName && emergencyPhone) {
      await tx.patientEmergencyContact.create({
        data: {
          patient_id: createdPatient.id,
          name: emergencyName,
          phone: emergencyPhone,
          relation: emergencyRelation || null
        }
      });
    }

    return createdPatient;
  });

  return patient;
};

/**
 * Get patient by ID with related data
 * @param {Number} id - Patient ID
 * @returns {Object} Patient with medical_history and emergency_contacts
 */
const getPatientById = async (id, scope = 'read', tenantId) => {
  const where = { id, is_deleted: false };
  if (tenantId) where.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({
    where,
    ...(scope === 'basic'
      ? { select: patientBasicSelect }
      : {
          include: {
            medical_history: true,
            emergency_contacts: true
          }
        })
  });

  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  return patient;
};

/**
 * Update patient
 * @param {number} id - Patient ID
 * @param {Object} updateData - Data to update
 * @returns {Object} Updated patient
 */
const updatePatient = async (id, data, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const existing = await prisma.patient.findFirst({
    where
  });

  if (!existing) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  const firstName = data.firstName !== undefined ? data.firstName : data.first_name;
  const lastName = data.lastName !== undefined ? data.lastName : data.last_name;
  const phone = data.phone;
  const email = data.email;
  const gender = data.gender;
  const rawDob = data.dateOfBirth !== undefined ? data.dateOfBirth : data.date_of_birth;
  const address = data.address;
  const patientType = data.patientType !== undefined ? data.patientType : data.patient_type;
  const behaviour = data.behaviour;
  const therapistId = data.therapistId !== undefined ? data.therapistId : data.therapist_id;
  const isActive = data.isActive !== undefined ? data.isActive : data.is_active;
  const allowSms = data.allowSms !== undefined ? data.allowSms : data.allow_sms;
  const allowEmail = data.allowEmail !== undefined ? data.allowEmail : data.allow_email;
  const allowNotifications = data.allowNotifications !== undefined ? data.allowNotifications : data.allow_notifications;
  const emergencyContact = data.emergencyContact !== undefined ? data.emergencyContact : (data.emergency_contacts && data.emergency_contacts[0]);

  // Check phone uniqueness if changing
  if (phone && phone.trim() !== existing.phone) {
    const existingPhone = await prisma.patient.findFirst({
      where: { phone: phone.trim(), tenant_id: tenantId || null, NOT: { id } }
    });

    if (existingPhone) {
      const error = new Error('Patient with this phone number already exists');
      error.statusCode = 400;
      throw error;
    }
  }

  // Check email uniqueness if changing
  if (email && email.trim() && email.trim().toLowerCase() !== existing.email) {
    const existingEmail = await prisma.patient.findFirst({
      where: { email: email.trim().toLowerCase(), tenant_id: tenantId || null, NOT: { id } }
    });

    if (existingEmail) {
      const error = new Error('Patient with this email already exists');
      error.statusCode = 400;
      throw error;
    }
  }

  // Validate therapist if provided
  if (therapistId !== undefined && therapistId !== null) {
    const therapist = await prisma.user.findUnique({
      where: { id: therapistId }
    });

    if (!therapist || therapist.role !== 'therapist') {
      const error = new Error('Invalid therapist ID');
      error.statusCode = 400;
      throw error;
    }
  }

  // Build update data (only include provided fields)
  const updateData = {};

  if (firstName !== undefined) updateData.first_name = firstName.trim();
  if (lastName !== undefined) updateData.last_name = lastName.trim();
  if (phone !== undefined) updateData.phone = phone.trim();
  if (email !== undefined) updateData.email = email ? email.trim().toLowerCase() : null;
  if (gender !== undefined) updateData.gender = gender;
  if (rawDob !== undefined) {
    let parsedDob = null;
    if (rawDob) {
      let d = null;
      if (rawDob instanceof Date && !isNaN(rawDob.getTime())) {
        d = rawDob;
      } else if (typeof rawDob === 'string') {
        const trimmed = rawDob.trim();
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(trimmed)) {
          const parts = trimmed.split(/[\/\-]/);
          d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        } else {
          d = new Date(trimmed);
        }
      }
      if (d && !isNaN(d.getTime())) {
        const year = d.getFullYear();
        if (year >= 1900 && year <= 2100) {
          parsedDob = d;
        }
      }
    }
    updateData.date_of_birth = parsedDob;
  }
  if (address !== undefined) updateData.address = address ? address.trim() : null;
  if (patientType !== undefined) updateData.patient_type = patientType;
  if (behaviour !== undefined) updateData.behaviour = behaviour;
  if (therapistId !== undefined) updateData.therapist_id = therapistId;
  if (isActive !== undefined) updateData.is_active = isActive;
  if (allowSms !== undefined) updateData.allow_sms = allowSms;
  if (allowEmail !== undefined) updateData.allow_email = allowEmail;
  if (allowNotifications !== undefined) updateData.allow_notifications = allowNotifications;

  const emergencyName = String(emergencyContact?.name || '').trim();
  const emergencyPhone = String(emergencyContact?.phone || '').trim();
  const emergencyRelation = String(emergencyContact?.relation || '').trim();

  const patient = await prisma.$transaction(async (tx) => {
    const updatedPatient = await tx.patient.update({
      where: { id },
      data: updateData
    });

    if (emergencyContact !== undefined) {
      const existingPrimary = await tx.patientEmergencyContact.findFirst({
        where: { patient_id: id },
        orderBy: { id: 'asc' }
      });

      if (emergencyName && emergencyPhone) {
        if (existingPrimary) {
          await tx.patientEmergencyContact.update({
            where: { id: existingPrimary.id },
            data: {
              name: emergencyName,
              phone: emergencyPhone,
              relation: emergencyRelation || null
            }
          });
        } else {
          await tx.patientEmergencyContact.create({
            data: {
              patient_id: id,
              name: emergencyName,
              phone: emergencyPhone,
              relation: emergencyRelation || null
            }
          });
        }
      } else if (existingPrimary) {
        // If user clears emergency contact fields, remove the stored primary contact.
        await tx.patientEmergencyContact.delete({ where: { id: existingPrimary.id } });
      }
    }

    return updatedPatient;
  });

  return patient;
};

/**
 * Delete patient by ID
 * @param {Number} id - Patient ID
 * @returns {Object} Deleted patient
 */
const deletePatient = async (id, tenantId) => {
  // Check patient exists and is not already deleted
  const where = { id, is_deleted: false };
  if (tenantId) where.tenant_id = tenantId;
  const existing = await prisma.patient.findFirst({
    where
  });

  if (!existing) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  // Perform Cascade Soft-Delete in a transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Soft delete appointments
    await tx.appointment.updateMany({
      where: { patient_id: id },
      data: { status: 'cancelled' }
    });

    // 2. Clear medical history and emergency contacts (optional, but keep for now)
    // 3. Mark patient as deleted
    return await tx.patient.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: new Date()
      }
    });
  });
};

const getMedicalHistoryByPatientId = async (patientId, tenantId) => {
  const where = { id: patientId, is_deleted: false };
  if (tenantId) where.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({
    where,
    select: { id: true }
  });

  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  const medicalHistory = await prisma.patientMedicalHistory.findUnique({
    where: { patient_id: patientId }
  });

  return medicalHistory || null;
};

const upsertMedicalHistory = async (patientId, medicalHistoryData, tenantId) => {
  const where = { id: patientId, is_deleted: false };
  if (tenantId) where.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({
    where,
    select: { id: true }
  });

  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  const {
    existingConditions,
    allergies,
    chronicDiseases,
    surgeries,
    longTermNotes
  } = medicalHistoryData;

  return await prisma.patientMedicalHistory.upsert({
    where: { patient_id: patientId },
    update: {
      existing_conditions: existingConditions ?? null,
      allergies: allergies ?? null,
      chronic_diseases: chronicDiseases ?? null,
      surgeries: surgeries ?? null,
      long_term_notes: longTermNotes ?? null
    },
    create: {
      patient_id: patientId,
      existing_conditions: existingConditions ?? null,
      allergies: allergies ?? null,
      chronic_diseases: chronicDiseases ?? null,
      surgeries: surgeries ?? null,
      long_term_notes: longTermNotes ?? null
    }
  });
};

module.exports = {
  getAllPatients,
  createPatient,
  getPatientById,
  updatePatient,
  deletePatient,
  getMedicalHistoryByPatientId,
  upsertMedicalHistory
};