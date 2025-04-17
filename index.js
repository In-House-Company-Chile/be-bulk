const fs = require('fs');
// const CheckNorms = require('./functions/CheckNorms');
const CheckLastNorms = require('./functions/CheckLastNorms');
const nodecron = require('node-cron');
const UploadFiles = require('./functions/UploadFiles');

const HORARIO_BLOQUEADO = { inicio: 0, fin: 6 };
const PAUSA_CADA_PETICIONES = 100;
const PAUSA_MINUTOS = 5;
const ID_NORM = 1;
// const MAX_ID = 5;
const LOG_DIR = 'logs';
const path = 'norms/';


// Asegurar que los directorios existen
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync('norms')) fs.mkdirSync('norms', { recursive: true });

// CheckNorms.create(ID_NORM, HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR)
// CheckLastNorms.create(ID_NORM, HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, LOG_DIR)

UploadFiles.create(path, 800, 'txt', 'pruebaNormas2', 'false')

// nodecron.schedule('0 0 * * *', async () => {
//     console.log('Ejecutando tarea programada cada día a la medianoche...');
//     await UploadFiles.create(path, 800, 'txt', 'pruebaNormas2', 'false')
// });
