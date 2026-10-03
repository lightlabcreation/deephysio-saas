const prisma = require('../../config/prisma');

/**
 * Get tasks for a patient
 * @param {Number} patientId - Patient ID
 * @param {Number} [tenantId] - Tenant context
 * @returns {Array} List of tasks
 */
const getTasksByPatientId = async (patientId, tenantId) => {
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

  return await prisma.task.findMany({
    where,
    orderBy: { created_at: 'desc' }
  });
};

/**
 * Create a new task
 * @param {Object} taskData - Task data
 * @param {Number} [tenantId] - Tenant context
 * @returns {Object} Created task
 */
const createTask = async (taskData, tenantId) => {
  const { patientId, title, description, dueDate } = taskData;
  const pid = parseInt(patientId, 10);

  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.task.create({
    data: {
      patient_id: pid,
      title: title.trim(),
      description: description ? description.trim() : null,
      due_date: dueDate ? new Date(dueDate) : null,
      status: 'pending',
      tenant_id: tenantId || null
    }
  });
};

/**
 * Update task by ID
 * @param {Number} id - Task ID
 * @param {Object} taskData - Fields to update
 * @param {Number} [tenantId] - Tenant context
 * @returns {Object} Updated task
 */
const updateTask = async (id, taskData, tenantId) => {
  const { title, description, status, dueDate } = taskData;
  const tid = parseInt(id, 10);

  const where = { id: tid };
  if (tenantId) where.tenant_id = tenantId;

  const existing = await prisma.task.findFirst({ where });
  if (!existing) {
    const error = new Error('Task not found');
    error.statusCode = 404;
    throw error;
  }

  const updateData = {};
  if (title !== undefined) updateData.title = title.trim();
  if (description !== undefined) updateData.description = description ? description.trim() : null;
  if (status !== undefined) updateData.status = status;
  if (dueDate !== undefined) updateData.due_date = dueDate ? new Date(dueDate) : null;

  return await prisma.task.update({
    where: { id: tid },
    data: updateData
  });
};

module.exports = {
  getTasksByPatientId,
  createTask,
  updateTask
};
