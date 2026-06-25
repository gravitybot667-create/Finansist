const localtunnel = require('localtunnel');
const fs = require('fs');
const { execSync } = require('child_process');

async function startTunnel() {
  try {
    const tunnel = await localtunnel({ port: 8000 });
    console.log(`Tunnel URL: ${tunnel.url}`);
    
    // Update .env with new URL
    let env = fs.readFileSync('.env', 'utf8');
    env = env.replace(/WEBAPP_URL=.*/, `WEBAPP_URL=${tunnel.url}`);
    fs.writeFileSync('.env', env);
    
    console.log("Updated .env with new WEBAPP_URL");
    
    tunnel.on('close', () => {
      console.log('Tunnel closed, restarting...');
      setTimeout(startTunnel, 1000);
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
      tunnel.close();
    });

    setInterval(() => {}, 1000 * 60 * 60);

  } catch (err) {
    console.error('Error creating tunnel:', err);
    setTimeout(startTunnel, 5000);
  }
}

startTunnel();
