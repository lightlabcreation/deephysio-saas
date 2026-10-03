const prisma = require('../../config/prisma');

/**
 * Get all files for a patient
 * @param {number} patientId - Patient ID
 * @param {number} [tenantId] - Optional tenant context
 */
const getFilesByPatientId = async (patientId, tenantId) => {
  const pid = parseInt(patientId, 10);
  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  const where = { patient_id: pid };
  if (tenantId) where.tenant_id = tenantId;

  return await prisma.file.findMany({
    where,
    orderBy: { created_at: 'desc' }
  });
};

/**
 * Create a new file record
 * @param {Object} fileData - File metadata
 * @param {number} [tenantId] - Optional tenant context
 */
const createFile = async (fileData, tenantId) => {
  const { patientId, fileName, fileUrl, fileType } = fileData;
  const pid = parseInt(patientId, 10);

  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.file.create({
    data: {
      patient_id: pid,
      file_name: fileName,
      file_url: fileUrl,
      file_type: fileType,
      tenant_id: tenantId || null
    }
  });
};

/**
 * Delete file metadata by id
 * @param {number} fileId
 * @param {number} [tenantId] - Optional tenant context
 */
const deleteFile = async (fileId, tenantId) => {
  const fid = parseInt(fileId, 10);
  const where = { id: fid };
  if (tenantId) where.tenant_id = tenantId;

  const existing = await prisma.file.findFirst({ where });
  if (!existing) {
    const error = new Error('File not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.file.delete({
    where: { id: fid }
  });
};

module.exports = {
  getFilesByPatientId,
  createFile,
  deleteFile
};
