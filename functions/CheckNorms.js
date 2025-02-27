const ExtractText = require('./ExtractText');
const LogsError = require('./LogsError');
const MergeHtml = require('./MergeHtml');
const UpdateLastProcess = require('./UpdateLastProcess');

const fs = require('fs');
const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


class CheckNorms {
    constructor(ID_NORM, HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR) {
        this.ID_NORM = ID_NORM; 
        this.HORARIO_BLOQUEADO = HORARIO_BLOQUEADO; 
        this.PAUSA_CADA_PETICIONES = PAUSA_CADA_PETICIONES; 
        this.PAUSA_MINUTOS = PAUSA_MINUTOS; 
        this.MAX_ID = MAX_ID; 
        this.LOG_DIR = LOG_DIR; 
    }

    static async create(ID_NORM, HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR) {
        return await new CheckNorms(ID_NORM, HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS, MAX_ID, LOG_DIR).check()
    }

    async check () {
        try {
            let requestCount = 0;
    
            // Cargar el último ID procesado si existe
            if (fs.existsSync(`${this.LOG_DIR}/last_norm.log`)) {
                this.idNorma = parseInt(fs.readFileSync(`${this.LOG_DIR}/last_norm.log`, 'utf8')) || 1;
                console.log(`🔄 Reanudando desde la norma ID: ${this.idNorma}`);
            }
    
            while (this.ID_NORM <= this.MAX_ID) {
                const currentHour = new Date().getHours();
    
                // Si estamos en horario bloqueado, esperar hasta que termine
                if (currentHour >= this.HORARIO_BLOQUEADO.inicio && currentHour < this.HORARIO_BLOQUEADO.fin) {
                    console.log(`🕒 Horario bloqueado (${this.HORARIO_BLOQUEADO.inicio}:00 - ${this.HORARIO_BLOQUEADO.fin}:00). Esperando...`);
                    await sleep((this.HORARIO_BLOQUEADO.fin - currentHour) * 60 * 60 * 1000);
                }
    
                const url = `https://nuevo.leychile.cl/servicios/Navegar/get_norma_json?idNorma=${this.ID_NORM}`;
                let response;
                try {
                    console.log("🚀 ~ check ~ this.ID_NORM:", this.ID_NORM);
                    response = await axios.get(url, { responseType: 'json' });
    
                    if (response.data) {
                        // Aplicar la función recursiva antes de guardar el JSON
                        const htmlUnificado = MergeHtml.create(response.data);
                        const planeText = ExtractText.create(htmlUnificado)
                        const data = response.data
    
                        // Guardar JSON con HTML estructurado
                        const jsonData = { idNorm: this.ID_NORM, texto: htmlUnificado, planeText: planeText, data, metadatos: JSON.stringify(data.metadatos) };
                        fs.writeFileSync(`norms/${this.ID_NORM}.json`, JSON.stringify(jsonData, null, 2));
    
                        // Guardar el último ID procesado
                        UpdateLastProcess.create(this.ID_NORM, this.LOG_DIR);
    
                        requestCount++;
                    } else {
                        LogsError.create(this.ID_NORM, "Respuesta vacía o inválida.", this.LOG_DIR);
                    }
                } catch (e) {
                    console.error(`❌ Error al obtener ${url}:`, e.response?.status || e.message);
                    LogsError.create(this.ID_NORM, `DATA: ${response && response.data ? response.data : response} -> ERROR: ${e}`, this.LOG_DIR);
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
            console.error("🚨 Error general en CheckNorms():", e.message);
            throw new Error("Error al ejecutar la función CheckNorms()");
        }
    };
}

module.exports = CheckNorms