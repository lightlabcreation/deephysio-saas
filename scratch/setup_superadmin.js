const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function ensureSuperAdmin() {
  const email = 'superadmin@deephysio.com';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const salt = await bcrypt.genSalt(10);
    const password = await bcrypt.hash('superadmin123', salt);
    user = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email,
        password,
        role: 'superadmin',
        allowed_menus: JSON.stringify(['Dashboard', 'Settings'])
      }
    });
    console.log('Created SuperAdmin');
  } else {
    console.log('SuperAdmin exists');
  }
  await prisma.$disconnect();
}

ensureSuperAdmin();
