// Universal Root App Entry Point
// Ensures hosting environments looking for ./app.js (Hostinger, cPanel, Passenger, PM2, Docker) succeed immediately
const app = require('./src/app.js');

// If executed directly (e.g. `node app.js`, PM2, or hosting start script), start the server
if (require.main === module) {
  require('./src/server.js');
}

module.exports = app;
