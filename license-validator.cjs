const { machineIdSync } = require('node-machine-id');

// Nueva URL desplegada de Google Apps Script
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx0MMEU85ggFwryKIJs2XjpgCc8DeVXQ0OppZV3A5EYxGWG7WeD0IYpK2YIGfNX7Y2i/exec';

async function validateOnline(email) {
  try {
    const hwid = machineIdSync();

    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // Usamos text/plain para evitar bloqueos de CORS preflight en la Web App de Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
      body: JSON.stringify({ email, hwid })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error al conectar con la licencia:', error);
    return { authorized: false, message: 'Error de conexión con el servidor' };
  }
}

module.exports = { validateOnline };