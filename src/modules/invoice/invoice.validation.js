const Joi = require('joi');

const createInvoiceValidation = (data) => {
  const schema = Joi.object({
    patientId: Joi.number().required(),
    date: Joi.date().iso().required(),
    items: Joi.array().items(
      Joi.object({
        service: Joi.string().required(),
        rate: Joi.number().required(),
        qty: Joi.number().min(1).required()
      })
    ).min(1).required(),
    notes: Joi.string().trim().allow(null, '').optional(),
    subtotal: Joi.number().optional(),
    tax: Joi.number().optional(),
    total: Joi.number().optional()
  }).unknown(true);

  return schema.validate(data, { abortEarly: false });
};

const paramIdValidation = (params) => {
  const schema = Joi.object({
    id: Joi.string().uuid().required()
  });

  return schema.validate(params, { abortEarly: false });
};

module.exports = {
  createInvoiceValidation,
  paramIdValidation
};
