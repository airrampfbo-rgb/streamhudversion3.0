const REMOTE_BASE_URL = 'https://streamhud-multisport.vercel.app';

const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let httpServer = null;
let allowedSportsInMemory = [];

// Directorio local dentro de userData para almacenar la caché descargada de Vercel
function getCacheDir() {
  const cachePath = path.join(app.getPath('userData'), 'remote_cache');
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }
  return cachePath;
}

// Descarga un archivo remoto desde Vercel y lo guarda localmente
function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

// Purga deportes vencidos de la PC y descarga únicamente los contratados desde Vercel
async function syncRemoteFiles(allowedSports) {
  allowedSportsInMemory = (allowedSports || []).map(s => s.trim().toLowerCase());
  const cacheDir = getCacheDir();

  // 1. Eliminar carpetas de deportes no autorizados o expirados
  try {
    const existingFolders = fs.readdirSync(cacheDir);
    existingFolders.forEach(folder => {
      const folderPath = path.join(cacheDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        if (!allowedSportsInMemory.includes(folder.toLowerCase())) {
          fs.rmSync(folderPath, { recursive: true, force: true });
        }
      }
    });
  } catch (err) {
    console.error("Error al limpiar carpetas en caché:", err);
  }

  // 2. Descargar únicamente los deportes contratados desde Vercel
  const downloads = [];
  allowedSportsInMemory.forEach(sportFolder => {
    downloads.push(downloadFile(`${REMOTE_BASE_URL}/${sportFolder}/Control.html`, path.join(cacheDir, sportFolder, 'Control.html')));
    downloads.push(downloadFile(`${REMOTE_BASE_URL}/${sportFolder}/overlay.html`, path.join(cacheDir, sportFolder, 'overlay.html')));
  });

  await Promise.all(downloads);
}

function startServers(allowedSports = ['futbol'], port = 3000) {
  if (httpServer) {
    stopServers();
  }

  // Sincronizar archivos remotos con Vercel
  syncRemoteFiles(allowedSports);

  const expressApp = express();
  httpServer = http.createServer(expressApp);

  // Filtro de seguridad: Bloquea deportes no incluidos en la licencia
  expressApp.use('/:sport', (req, res, next) => {
    const requestedSport = req.params.sport.toLowerCase();
    
    if (requestedSport.includes('.') || requestedSport === 'favicon.ico') {
      return next();
    }

    if (!allowedSportsInMemory.includes(requestedSport)) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Módulo No Autorizado - StreamHUD</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
            body {
              background: #020b14;
              color: #f7f9ff;
              font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: 20px;
              text-align: center;
            }
            .card {
              background: linear-gradient(135deg, #071526, #03101d);
              border: 1px solid #1f3855;
              border-radius: 16px;
              padding: 28px 22px;
              max-width: 380px;
              width: 100%;
              box-shadow: 0 10px 30px rgba(0,0,0,0.6);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 12px;
            }
            .icon { font-size: 2.2rem; margin-bottom: 2px; }
            h2 { font-size: 1.25rem; color: #ff5252; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
            .subtitle { font-size: 0.85rem; color: #8291ad; line-height: 1.4; }
            .sport-tag { color: #00f2d2; font-weight: 900; }
            .callout {
              font-size: 0.82rem;
              color: #e2e8f0;
              font-weight: 700;
              margin-top: 6px;
              border-top: 1px solid #16344e;
              padding-top: 12px;
              width: 100%;
            }
            .btn-shop {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              width: 100%;
              margin-top: 6px;
              padding: 12px;
              background: linear-gradient(90deg, #00f2d2, #00f29a);
              color: #02170f;
              text-decoration: none;
              font-weight: 900;
              font-size: 0.82rem;
              border-radius: 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              box-shadow: 0 0 15px rgba(0, 242, 210, 0.2);
              transition: all 0.2s ease;
            }
            .btn-shop:hover {
              transform: translateY(-2px);
              box-shadow: 0 0 20px rgba(0, 242, 210, 0.4);
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🔒</div>
            <h2>Módulo No Autorizado</h2>
            <p class="subtitle">Tu suscripción actual no incluye el deporte <span class="sport-tag">${requestedSport.toUpperCase()}</span>.</p>
            <p class="callout">Adquirí tu licencia para continuar transmitiendo</p>
            <a href="https://streamhud.io/shop/" target="_blank" class="btn-shop">🛒 VISITAR TIENDA STREAMHUD</a>
          </div>
        </body>
        </html>
      `);
    }
    next();
  });

  // Servidor de archivos estáticos por deporte
  expressApp.get('/:sport/:file', (req, res) => {
    const sport = req.params.sport.toLowerCase();
    let file = req.params.file.toLowerCase();

    if (!file.endsWith('.html')) {
      file += '.html';
    }

    const sportDir = path.join(getCacheDir(), sport);
    let targetFileName = file;

    if (fs.existsSync(sportDir)) {
      const files = fs.readdirSync(sportDir);
      const found = files.find(f => f.toLowerCase() === file);
      if (found) targetFileName = found;
    }

    const cachePath = path.join(sportDir, targetFileName);

    if (fs.existsSync(cachePath)) {
      res.sendFile(cachePath);
    } else {
      res.status(404).send('Archivo no encontrado');
    }
  });

  // Servidor WebSocket interno para sincronización en tiempo real
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.toString());
        }
      });
    });
  });

  httpServer.listen(port, '0.0.0.0');

  return {
    baseUrl: `http://localhost:${port}`
  };
}

function stopServers() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

module.exports = { startServers, stopServers };