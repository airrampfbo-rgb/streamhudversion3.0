const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { validateLicense, validateOnline, saveLicense } = require('./validator');
const { startServers, stopServers } = require('./server');

app.disableHardwareAcceleration();

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx0MMEU85ggFwryKIJs2XjpgCc8DeVXQ0OppZV3A5EYxGWG7WeD0IYpK2YIGfNX7Y2i/exec';

const store = new Store();
let mainWindow = null;
let currentAuthData = null;

function getActiveEmail() {
  if (currentAuthData && currentAuthData.email) {
    return currentAuthData.email;
  }
  const fromStore = store.get('email');
  if (fromStore) return fromStore;

  try {
    const licensePath = path.join(app.getPath('userData'), 'license.json');
    if (fs.existsSync(licensePath)) {
      const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      if (data && data.email) return data.email;
    }
  } catch (e) {}

  return null;
}

async function clearSessionData() {
  currentAuthData = null;
  store.clear();
  try {
    const licensePath = path.join(app.getPath('userData'), 'license.json');
    if (fs.existsSync(licensePath)) {
      fs.unlinkSync(licensePath);
    }
  } catch (e) {}

  if (mainWindow && mainWindow.webContents) {
    try {
      await mainWindow.webContents.session.clearStorageData();
    } catch (e) {}
  }
}

function fetchLiveMessages(email) {
  return new Promise((resolve) => {
    if (!email) return resolve(null);

    const fullUrl = `${SCRIPT_URL}?email=${encodeURIComponent(email)}`;

    const request = net.request({
      method: 'GET',
      url: fullUrl
    });

    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (e) {
          resolve(null);
        }
      });
    });

    request.on('error', () => resolve(null));
    request.end();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 680,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const authResult = await validateLicense(SCRIPT_URL);

  if (authResult.authorized) {
    const savedEmail = getActiveEmail() || authResult.email;
    currentAuthData = { ...authResult, email: savedEmail };
    startServers(authResult.deportes);
    mainWindow.loadFile('Launcher.html');
  } else {
    mainWindow.loadFile('Activate.html');
  }
}

ipcMain.handle('submit-license-email', async (event, payload) => {
  const email = typeof payload === 'string' ? payload : payload.email;
  
  if (email) store.set('email', email);

  const result = await validateOnline(payload, SCRIPT_URL);
  
  if (result.authorized) {
    saveLicense(email);
    currentAuthData = { ...result, email: email };
    startServers(result.deportes);
    mainWindow.loadFile('Launcher.html');
  }
  
  return result;
});

ipcMain.handle('get-auth-data', () => currentAuthData);

ipcMain.handle('get-messages', async () => {
  const email = getActiveEmail();
  let personalMsg = "";
  let globalMsg = "";

  if (email) {
    const liveData = await fetchLiveMessages(email);
    if (liveData) {
      personalMsg = liveData.personalMessage || "";
      globalMsg = liveData.globalMessage || "";
    }
  }

  if (!personalMsg && currentAuthData?.personalMessage) personalMsg = currentAuthData.personalMessage;
  if (!globalMsg && currentAuthData?.globalMessage) globalMsg = currentAuthData.globalMessage;

  return { personalMessage: personalMsg, globalMessage: globalMsg };
});

ipcMain.handle('open-external', (event, url) => {
  if (url) shell.openExternal(url);
});

ipcMain.handle('logout', async () => {
  stopServers();
  await clearSessionData();
  if (mainWindow) {
    mainWindow.loadFile('Activate.html');
  }
  return { success: true };
});

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
  createWindow();
});

app.on('window-all-closed', () => {
  stopServers();
  if (process.platform !== 'darwin') app.quit();
});