const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  if (process.env.NODE_ENV !== 'production') {
    console.error('[API]', req.method, req.originalUrl, statusCode, err.message);
    if (err.stack) console.error(err.stack);
  }

  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
};

module.exports = {
  errorHandler
};
