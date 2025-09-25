const ExtractText = require('./ExtractText');
const LogsError = require('./LogsError');
const MergeHtml = require('./MergeHtml');
const UpdateLastProcess = require('./UpdateLastProcess');
const IndexarPsql = require('./IndexarPsql');
// const IndexarMongo = require('./IndexarMongo');
// const IndexarPinecone = require('./IndexarPinecone');
const IndexarQdrantV2 = require('./IndexarQdrantV2');
const LoadNormasFromJSON = require('./LoadNormasFromJSON');

const fs = require('fs');
const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


class CheckLastNorms {
    constructor(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, LOG_DIR, dbName, dbCollection, namespace) {
        this.ID_NORM = 1211458;
        this.HORARIO_BLOQUEADO = HORARIO_BLOQUEADO;
        this.PAUSA_CADA_PETICIONES = PAUSA_CADA_PETICIONES;
        this.PAUSA_MINUTOS = PAUSA_MINUTOS;
        this.LOG_DIR = LOG_DIR;
        this.dbName = dbName;
        this.dbCollection = dbCollection;
        this.namespace = namespace;
    }

    static async create(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR, dbName, dbCollection, namespace) {
        return await new CheckLastNorms(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR, dbName, dbCollection, namespace).check()
    }

    async check() {
        try {
            let requestCount = 0;
            let errorCount = 0;
            const MAX_ERRORES_CONSECUTIVOS = 100;

            // Cargar el último ID procesado si existe
            if (fs.existsSync(`${this.LOG_DIR}/last_norm.log`)) {
                this.ID_NORM = parseInt(fs.readFileSync(`${this.LOG_DIR}/last_norm.log`, 'utf8')) || 1;
                console.log(`🔄 Reanudando desde la norma ID: ${this.ID_NORM}`);
            }

            while (errorCount < MAX_ERRORES_CONSECUTIVOS) {
                const currentHour = new Date().getHours();

                // Si estamos en horario bloqueado, esperar hasta que termine
                if (currentHour >= this.HORARIO_BLOQUEADO.inicio && currentHour < this.HORARIO_BLOQUEADO.fin) {
                    console.log(`🕒 Horario bloqueado (${this.HORARIO_BLOQUEADO.inicio}:00 - ${this.HORARIO_BLOQUEADO.fin}:00). Esperando...`);
                    await sleep((this.HORARIO_BLOQUEADO.fin - currentHour) * 60 * 60 * 1000);
                }

                const url = `https://nuevo.leychile.cl/servicios/Navegar/get_norma_json?idNorma=${this.ID_NORM}`;
                let response;
                try {
                    console.log("🚀 ~ check ~ idNorma:", this.ID_NORM);
                    response = await axios.get(url, { responseType: 'json' });

                    if (response.data && response.data.metadatos) {
                        // Aplicar la función recursiva antes de guardar el JSON
                        const htmlUnificado = MergeHtml.create(response.data);
                        const planeText = ExtractText.create(htmlUnificado);
                        const data = response.data;

                        // Guardar JSON con HTML estructurado
                        const jsonData = { idNorm: this.ID_NORM, texto: htmlUnificado, planeText: planeText, data, metadatos: JSON.stringify(data.metadatos) };

                        const indexMongo = await IndexarPsql.create(jsonData, 'normas');
                        console.log("🚀 ~ CheckLastNorms ~ check ~ indexMongo:", indexMongo)
                        // if (indexMongo !== 'OK') {
                        fs.writeFileSync(`norms/${this.ID_NORM}.json`, JSON.stringify(jsonData, null, 2));
                        LoadNormasFromJSON.create(jsonData, 'facets')
                        // TODO: Indexar en QDRANT
                        await IndexarQdrantV2.create(jsonData, jsonData.planeText, this.namespace, {});
                        return;
                        // await IndexarPinecone.create(jsonData, 'bigdata', this.namespace);
                        // }
                        // Guardar el último ID procesado
                        UpdateLastProcess.create(this.ID_NORM, this.LOG_DIR);

                        // Reiniciar contador de errores al encontrar un `idNorma` válido
                        errorCount = 0;
                        requestCount++;
                    } else {
                        LogsError.create(this.ID_NORM, "Respuesta vacía o inválida.", this.LOG_DIR);
                        errorCount++;
                    }
                } catch (e) {
                    console.error(`❌ Error al obtener ${url}:`, e.response?.status || e.message);
                    LogsError.create(this.ID_NORM, `DATA: ${response && response.data ? response.data : response} -> ERROR: ${e}`, this.LOG_DIR);
                    errorCount++;
                }

                // Si se alcanza el límite de errores consecutivos, detener el proceso
                if (errorCount >= MAX_ERRORES_CONSECUTIVOS) {
                    console.log(`🚨 Se han alcanzado ${MAX_ERRORES_CONSECUTIVOS} errores consecutivos. Finalizando iteración.`);
                    break;
                }

                // Pausa aleatoria entre peticiones (1 a 10 segundos)
                const delay = Math.floor(Math.random() * 9000) + 1000;
                console.log(`⏳ Esperando ${delay / 1000} segundos antes de la siguiente petición...`);
                await sleep(delay);

                // Pausar cada 100 peticiones por n minutos
                if (requestCount >= this.PAUSA_CADA_PETICIONES) {
                    console.log(`⏸️ Se alcanzaron ${this.PAUSA_CADA_PETICIONES} peticiones. Pausando por ${this.PAUSA_MINUTOS} minutos...`);
                    await sleep(this.PAUSA_MINUTOS * 60 * 1000);
                    requestCount = 0;
                }

                this.ID_NORM++;
            }
        } catch (e) {
            console.error("🚨 Error general en CheckLastNorms():", e.message);
            throw new Error("Error al ejecutar la función CheckLastNorms()");
        }
    };
}

module.exports = CheckLastNorms