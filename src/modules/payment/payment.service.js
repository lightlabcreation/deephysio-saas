const prisma = require('../../config/prisma');
const { notifyPaymentReceived } = require('../whatsapp/whatsappNotification.service');

const getAllPayments = async (filters, tenantId) => {
  const { patientId, invoiceId, startDate, endDate } = filters;
  const where = {};
  if (tenantId) where.tenant_id = tenantId;

  if (patientId) where.patient_id = parseInt(patientId, 10);
  if (invoiceId) where.invoice_id = invoiceId;

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  return await prisma.payment.findMany({
    where,
    include: {
      patient: { select: { id: true, first_name: true, last_name: true, patient_type: true } },
      invoice: true
    },
    orderBy: { created_at: 'desc' }
  });
};

const getPaymentById = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const payment = await prisma.payment.findFirst({
    where,
    include: {
      patient: { select: { id: true, first_name: true, last_name: true } },
      invoice: true
    }
  });

  if (!payment) {
    const error = new Error('Payment record not found');
    error.statusCode = 404;
    throw error;
  }

  return payment;
};

const createPayment = async (data, tenantId) => {
  let { patient_id, patientId: pId, invoice_id, invoiceId: invId, amount, date, method, status, description } = data;
  const totalAmount = parseFloat(amount);
  const patientId = parseInt(patient_id || pId, 10);
  invoice_id = invoice_id || invId || null;

  // Validate patient belongs to tenant
  const patientWhere = { id: patientId };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  // --- SMART BULK LINKING ---
  if (!invoice_id) {
    const pendingInvoices = await prisma.invoice.findMany({
      where: { patient_id: patientId, status: 'PENDING', ...(tenantId ? { tenant_id: tenantId } : {}) },
      orderBy: { date: 'asc' }
    });

    let remainingAmount = totalAmount;
    let firstInvoiceId = null;

    // We will create multiple payment records if this is a bulk payment covering multiple invoices
    for (const inv of pendingInvoices) {
      const invTotal = parseFloat(inv.total);
      if (remainingAmount >= invTotal - 0.01) {
        // This invoice is fully covered
        if (!firstInvoiceId) {
          // First one will use the main request logic (updated below)
          firstInvoiceId = inv.id;
          remainingAmount -= invTotal;
        } else {
          // Create additional payment records for other invoices
          await prisma.payment.create({
            data: {
              patient_id: patientId,
              invoice_id: inv.id,
              amount: invTotal,
              date: new Date(date),
              method,
              status: 'COMPLETED',
              description: `Bulk payment part (Total: ₹${totalAmount})`,
              tenant_id: tenantId || null
            }
          });
          await prisma.invoice.update({
            where: { id: inv.id },
            data: { status: 'PAID' }
          });
          remainingAmount -= invTotal;
        }
      } else if (remainingAmount > 0) {
        // Partial coverage for this invoice (optional: link whatever is left)
        if (!firstInvoiceId) firstInvoiceId = inv.id;
        break;
      }
    }
    
    if (firstInvoiceId) {
      invoice_id = firstInvoiceId;
      amount = totalAmount - remainingAmount;
      if (remainingAmount > 0 && pendingInvoices.length > 0) {
        amount = totalAmount;
      }
      if (totalAmount !== remainingAmount) {
         amount = totalAmount - (totalAmount - (parseFloat(pendingInvoices.find(i => i.id === firstInvoiceId).total)));
      }
    }
  }

  // Final payment record creation
  const payment = await prisma.payment.create({
    data: {
      patient_id: patientId,
      invoice_id,
      amount: parseFloat(amount),
      date: new Date(date),
      method,
      status: status || 'COMPLETED',
      description,
      tenant_id: tenantId || null
    },
    include: {
      patient: true,
      invoice: true
    }
  });

  if (invoice_id) {
    await syncInvoiceStatus(invoice_id, tenantId);
  }

  // --- Additive WhatsApp Notification (Non-blocking) ---
  try {
    const notifyTenantId = payment.patient?.tenant_id || tenantId || payment.tenant_id;
    if (notifyTenantId) {
      notifyPaymentReceived({
        tenantId: notifyTenantId,
        patient: payment.patient,
        amount: payment.amount,
        invoiceNumber: payment.invoice?.invoice_number || `INV-${payment.invoice_id || payment.id}`,
        paymentMethod: payment.method
      });
    }
  } catch (err) {
    console.warn('[WhatsApp Notification] Non-blocking payment trigger skipped:', err.message);
  }

  return payment;
};

/**
 * Helper to update invoice status based on payment totals
 */
const syncInvoiceStatus = async (invoiceId, tenantId) => {
  const where = { id: invoiceId };
  if (tenantId) where.tenant_id = tenantId;
  const invoice = await prisma.invoice.findFirst({
    where,
    include: { payments: true }
  });

  if (!invoice) return;

  const totalPaid = invoice.payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const totalDue = parseFloat(invoice.total || 0);

  if (totalPaid >= totalDue - 0.01) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID' }
    });
    
    // Log activity
    await prisma.systemActivityLog.create({
      data: {
        action: 'PAY_INVOICE',
        target_id: invoiceId,
        target_type: 'Invoice',
        details: `Invoice fully paid: ₹${totalPaid}`,
        meta: JSON.stringify({ amount: totalPaid }),
        tenant_id: tenantId || invoice.tenant_id || null
      }
    });
  }
};

const deletePayment = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const payment = await prisma.payment.findFirst({ where });
  if (!payment) {
    const error = new Error('Payment record not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.payment.delete({ where: { id } });
};

module.exports = {
  getAllPayments,
  getPaymentById,
  createPayment,
  deletePayment
};
