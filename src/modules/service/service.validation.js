const Joi = require('joi');

const createServiceValidation = (data) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(2).required(),
    category: Joi.string().trim().optional().allow(null, ''),
    duration: Joi.number().integer().greater(0).required(),
    price: Joi.number().greater(0).required(),
    is_active: Joi.boolean().optional(),
    isActive: Joi.boolean().optional(),
    status: Joi.string().trim().optional(),
    description: Joi.string().trim().optional().allow(null, '')
  }).unknown(false);

  return schema.validate(data, { abortEarly: false });
};

const updateServiceValidation = (data) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(2).optional(),
    category: Joi.string().trim().optional().allow(null, ''),
    duration: Joi.number().integer().greater(0).optional(),
    price: Joi.number().greater(0).optional(),
    is_active: Joi.boolean().optional(),
    isActive: Joi.boolean().optional(),
    status: Joi.string().trim().optional(),
    description: Joi.string().trim().optional().allow(null, '')
  }).unknown(false);

  return schema.validate(data, { abortEarly: false });
};

const paramIdValidation = (params) => {
  const schema = Joi.object({
    id: Joi.number().integer().required()
  });

  return schema.validate(params, { abortEarly: false });
};

module.exports = {
  createServiceValidation,
  updateServiceValidation,
  paramIdValidation
};
