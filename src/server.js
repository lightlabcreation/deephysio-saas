// Server entry point
const app = require('./app');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", async (err) => {
  if (err) {
    console.error("❌ SERVER FAILED:", err);
  } else {
    console.log(`🚀 Server running on port ${PORT}`);
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`✅ Database connected successfully (MySQL: deephysio)`);
    } catch (dbErr) {
      console.error(`❌ Database connection failed:`, dbErr.message);
    }
  }
});


