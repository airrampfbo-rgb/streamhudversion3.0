const { machineIdSync } = require('node-machine-id');
const Store = require('electron-store');
const { net } = require('electron');

const store = new Store();

function getHwid() {
  try {
    return machineIdSync();
  } catch (e) {
    return "";
  }
}

function saveLicense(email) {
  if (email) {
    store.set('email', email);
  }
}

function validateOnline(payload, scriptUrl) {
  return new Promise((resolve) => {
    const hwid = getHwid();
    const emailToSend = payload?.email || store.get('email') || "";

    const dataToSend = {
      email: emailToSend,
      hwid: hwid,
      sport: payload?.sport || "",
      plan: payload?.plan || ""
    };

    const request = net.request({
      method: 'POST',
      url: scriptUrl,
      headers: { 'Content-Type': 'application/json' }
    });

    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const res = JSON.parse(body);
          if (res && res.authorized && res.email) {
            saveLicense(res.email);
          }
          resolve(res);
        } catch (e) {
          resolve({ authorized: false, message: "Error leyendo respuesta del servidor." });
        }
      });
    });

    request.on('error', () => {
      resolve({ authorized: false, message: "Error de conexión." });
    });

    request.end(JSON.stringify(dataToSend));
  });
}

async function validateLicense(scriptUrl) {
  const savedEmail = store.get('email') || "";
  return await validateOnline({ email: savedEmail }, scriptUrl);
}

module.exports = { validateLicense, validateOnline, saveLicense };