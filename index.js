const fs = require('fs');
const CheckLastNorms = require('./functions/CheckLastNorms');
const nodecron = require('node-cron');

const HORARIO_BLOQUEADO = { inicio: 0, fin: 6 };
const PAUSA_CADA_PETICIONES = 100;
const PAUSA_MINUTOS = 5;
const LOG_DIR = 'logs';
const dbName = 'buscadorDB';
const dbCollection = 'normas';
const namespace = 'documentos';


// Asegurar que los directorios existen
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync('norms')) fs.mkdirSync('norms', { recursive: true });
if (!fs.existsSync('facets')) fs.mkdirSync('facets', { recursive: true });

nodecron.schedule('0 8 * * *', async () => {
    console.log('🕗 Iniciando verificación de normas a las 8:00 AM');
    CheckLastNorms.create(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, LOG_DIR, dbName, dbCollection, namespace)
});
