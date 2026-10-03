const appointmentService = require('./appointment.service');
const { logActivity } = require('../../utils/activityLogger');

const createAppointment = async (req, res) => {
  try {
    const appointment = await appointmentService.createAppointment(req.body, req.user?.tenant_id);

    await logActivity(
      req.user?.id, 
      'CREATE_APPOINTMENT', 
      appointment.id, 
      'Appointment', 
      `Booked appointment for Patient ID: ${appointment.patient_id}`,
      { entity: 'Appointment', entityId: appointment.id, label: `Patient ID: ${appointment.patient_id}` }
    );

    return res.status(201).json({
      success: true,
      data: appointment,
      message: "Appointment created successfully"
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error"
    });
  }
};

const getAllAppointments = async (req, res) => {
  try {
    const appointments = await appointmentService.getAllAppointments(req.query, req.user?.tenant_id);
    return res.status(200).json({ success: true, data: appointments });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

const getAppointmentById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const appointment = await appointmentService.getAppointmentById(id, req.user?.tenant_id);
    return res.status(200).json({ success: true, data: appointment });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

const updateAppointment = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const appointment = await appointmentService.updateAppointment(id, req.body, req.user?.tenant_id);
    return res.status(200).json({ success: true, data: appointment });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

const deleteAppointment = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deletedAppointment = await appointmentService.deleteAppointment(id, req.user?.tenant_id);
    return res.status(200).json({ 
      success: true, 
      data: deletedAppointment,
      message: "Appointment deleted successfully" 
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

const updateStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const appointment = await appointmentService.updateAppointmentStatus(id, req.body.status, req.user?.tenant_id);
    await logActivity(
      req.user?.id, 
      'UPDATE_APPOINTMENT', 
      appointment.id, 
      'Appointment', 
      `Changed appointment status to ${req.body.status}`,
      { entity: 'Appointment', entityId: appointment.id, label: req.body.status }
    );
    return res.status(200).json({ success: true, data: appointment });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Internal Server Error" });
  }
};

const getPractitioners = async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === 'superadmin';
    const tenantId = isSuperAdmin ? null : req.user?.tenant_id;
    const practitioners = await appointmentService.getPractitionersForScheduling(tenantId);
    return res.status(200).json({ success: true, data: practitioners });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  createAppointment,
  getAllAppointments,
  getAppointmentById,
  updateAppointment,
  deleteAppointment,
  updateStatus,
  getPractitioners
};
