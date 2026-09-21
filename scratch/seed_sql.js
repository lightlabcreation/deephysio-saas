const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function seedSuperAdmin() {
  try {
    const connection = await mysql.createConnection('mysql://root:@localhost:3306/deephysio');
    const email = 'superadmin@deephysio.com';
    
    const [rows] = await connection.execute('SELECT id FROM User WHERE email = ?', [email]);
    if (rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const password = await bcrypt.hash('superadmin123', salt);
      const id = 'clk' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7); // generate cuid-like id
      
      await connection.execute(
        'INSERT INTO User (id, name, email, password, role, allowed_menus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [id, 'Super Admin', email, password, 'superadmin', JSON.stringify(['Dashboard', 'Settings'])]
      );
      console.log('Created SuperAdmin via raw SQL');
    } else {
      console.log('SuperAdmin already exists');
    }
    await connection.end();
  } catch (error) {
    console.error('Error seeding:', error);
  }
}

seedSuperAdmin();
