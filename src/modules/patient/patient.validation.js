const Joi = require('joi');

const emergencyContactSchema = Joi.alternatives().try(
  Joi.object({
    name: Joi.string().trim().allow('', null).optional(),
    phone: Joi.string().trim().allow('', null).optional(),
    relation: Joi.string().trim().allow('', null).optional()
  }).optional(),
  Joi.array().items(
    Joi.object({
      name: Joi.string().trim().allow('', null).optional(),
      phone: Joi.string().trim().allow('', null).optional(),
      relation: Joi.string().trim().allow('', null).optional()
    })
  ).optional()
);

/**
 * Validate patient creation data
 * @param {Object} data - Patient data to validate
 * @returns {Object} Validation result
 */
const createPatientValidation = (data) => {
  // Normalize fields if passed in snake_case
  const normalizedData = {
    ...data,
    firstName: data.firstName || data.first_name,
    lastName: data.lastName !== undefined ? data.lastName : data.last_name,
    dateOfBirth: data.dateOfBirth !== undefined ? data.dateOfBirth : data.date_of_birth,
    emergencyContact: data.emergencyContact !== undefined ? data.emergencyContact : data.emergency_contacts,
  };

  // Clean email if string has spaces or empty
  if (typeof normalizedData.email === 'string') {
    normalizedData.email = normalizedData.email.replace(/\s+/g, '').trim();
    if (!normalizedData.email) delete normalizedData.email;
  }

  // If dateOfBirth is empty string, remove it so Joi date doesn't fail
  if (normalizedData.dateOfBirth === '' || normalizedData.dateOfBirth === null) {
    delete normalizedData.dateOfBirth;
  }

  const schema = Joi.object({
    firstName: Joi.string().trim().min(1).required(),
    first_name: Joi.string().trim().allow(null, '').optional(),
    lastName: Joi.string().trim().allow(null, '').optional(),
    last_name: Joi.string().trim().allow(null, '').optional(),
    phone: Joi.string().trim().min(6).max(20).required(),
    email: Joi.string().email().allow(null, '').optional(),
    gender: Joi.string().valid('male', 'female', 'other').lowercase().allow(null, '').optional(),
    dateOfBirth: Joi.any().optional(),
    date_of_birth: Joi.any().optional(),
    address: Joi.string().trim().allow(null, '').optional(),
    patientType: Joi.string().trim().allow(null, '').optional(),
    patient_type: Joi.string().trim().allow(null, '').optional(),
    behaviour: Joi.string().trim().allow(null, '').optional(),
    therapistId: Joi.number().integer().allow(null).optional(),
    therapist_id: Joi.number().integer().allow(null).optional(),
    emergencyContact: emergencyContactSchema,
    emergency_contacts: emergencyContactSchema,
  }).unknown(true);

  return schema.validate(normalizedData, { abortEarly: false });
};

/**
 * Validate patient update data
 * @param {Object} data - Patient data to validate
 * @returns {Object} Validation result
 */
const updatePatientValidation = (data) => {
  const normalizedData = {
    ...data,
    firstName: data.firstName || data.first_name,
    lastName: data.lastName !== undefined ? data.lastName : data.last_name,
    dateOfBirth: data.dateOfBirth !== undefined ? data.dateOfBirth : data.date_of_birth,
    emergencyContact: data.emergencyContact !== undefined ? data.emergencyContact : data.emergency_contacts,
  };

  if (typeof normalizedData.email === 'string') {
    normalizedData.email = normalizedData.email.replace(/\s+/g, '').trim();
    if (!normalizedData.email) delete normalizedData.email;
  }

  if (normalizedData.dateOfBirth === '' || normalizedData.dateOfBirth === null) {
    delete normalizedData.dateOfBirth;
  }

  const schema = Joi.object({
    firstName: Joi.string().trim().min(1).optional(),
    first_name: Joi.string().trim().allow(null, '').optional(),
    lastName: Joi.string().trim().allow(null, '').optional(),
    last_name: Joi.string().trim().allow(null, '').optional(),
    phone: Joi.string().trim().min(6).max(20).optional(),
    email: Joi.string().email().allow(null, '').optional(),
    gender: Joi.string().valid('male', 'female', 'other').allow(null, '').optional(),
    dateOfBirth: Joi.any().optional(),
    date_of_birth: Joi.any().optional(),
    address: Joi.string().trim().allow(null, '').optional(),
    patientType: Joi.string().trim().allow(null, '').optional(),
    patient_type: Joi.string().trim().allow(null, '').optional(),
    behaviour: Joi.string().trim().allow(null, '').optional(),
    therapistId: Joi.number().integer().allow(null).optional(),
    therapist_id: Joi.number().integer().allow(null).optional(),
    isActive: Joi.boolean().optional(),
    is_active: Joi.boolean().optional(),
    allowSms: Joi.boolean().optional(),
    allow_sms: Joi.boolean().optional(),
    allowEmail: Joi.boolean().optional(),
    allow_email: Joi.boolean().optional(),
    allowNotifications: Joi.boolean().optional(),
    allow_notifications: Joi.boolean().optional(),
    emergencyContact: emergencyContactSchema,
    emergency_contacts: emergencyContactSchema,
  }).unknown(true);

  return schema.validate(normalizedData, { abortEarly: false });
};

const upsertMedicalHistoryValidation = (data) => {
  const schema = Joi.object({
    existingConditions: Joi.string().allow('', null).optional(),
    allergies: Joi.string().allow('', null).optional(),
    chronicDiseases: Joi.string().allow('', null).optional(),
    surgeries: Joi.string().allow('', null).optional(),
    longTermNotes: Joi.string().allow('', null).optional()
  }).unknown(false);

  return schema.validate(data, { abortEarly: false });
};

/**
 * Validate param ID (must be integer)
 * @param {Object} params - Route params
 * @returns {Object} Validation result
 */
const paramIdValidation = (params) => {
  const schema = Joi.object({
    id: Joi.number().integer().required()
  });

  return schema.validate(params, { abortEarly: false });
};

module.exports = {
  createPatientValidation,
  updatePatientValidation,
  upsertMedicalHistoryValidation,
  paramIdValidation
};