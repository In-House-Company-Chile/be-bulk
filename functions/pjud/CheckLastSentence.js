const axios = require('axios');
const IndexarPsql = require('../shared/IndexarPsql');
const IndexarQdrantV2 = require('../shared/IndexarQdrantV2');
const GetCookies = require('./GetCookies');
const MultipartPayload = require('./MultipartPayload');
const MetadataByType = require('./MetadataByType');
const { basesDic, refererDic, baseArray } = require('./constants');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class CheckLastSentence {
    constructor(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS) {
        this.HORARIO_BLOQUEADO = HORARIO_BLOQUEADO;
        this.PAUSA_CADA_PETICIONES = PAUSA_CADA_PETICIONES;
        this.PAUSA_MINUTOS = PAUSA_MINUTOS;
        this.baseArray = baseArray;
        this.currentBaseIndex = 0;
        this.elementPerPage = 50;
    }

    static async create(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS) {
        return await new CheckLastSentence(HORARIO_BLOQUEADO, PAUSA_CADA_PETICIONES, PAUSA_MINUTOS).processAllBases()
    }

    async processAllBases() {
        console.log(`🚀 Iniciando procesamiento de ${this.baseArray.length} bases de datos...`);
        
        for (let i = 0; i < this.baseArray.length; i++) {
            this.currentBaseIndex = i;
            const BASE_NAME = this.baseArray[i];
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📊 Procesando base ${i + 1}/${this.baseArray.length}: ${BASE_NAME}`);
            console.log(`${'='.repeat(60)}\n`);
            
            try {
                await this.check(BASE_NAME);
                console.log(`\n✅ Base ${BASE_NAME} completada exitosamente\n`);
            } catch (error) {
                console.error(`\n❌ Error en base ${BASE_NAME}:`, error.message);
                console.log(`Continuando con la siguiente base...\n`);
            }
            
            // Pausa entre bases para evitar saturar el servidor
            if (i < this.baseArray.length - 1) {
                const pausaEntreBases = 5000; // 5 segundos
                console.log(`⏳ Esperando ${pausaEntreBases / 1000} segundos antes de la siguiente base...`);
                await sleep(pausaEntreBases);
            }
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎉 Procesamiento completo de todas las bases finalizado`);
        console.log(`${'='.repeat(60)}\n`);
    }

    async check(BASE_NAME) {
        try {
            // Reiniciar la página para cada nueva base
            let page = 0;
            console.log(`🚀 Iniciando scraping de base: ${BASE_NAME} desde página ${page}`);

            let requestCount = 0;
            let errorCount = 0;
            const MAX_ERRORES_CONSECUTIVOS = 10;
            const idBuscador = basesDic[BASE_NAME];
            const referer = refererDic[BASE_NAME];
            const headers = {
                'Accept': 'text/html, */*; q=0.01',
                'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
                'Connection': 'keep-alive',
                'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryIoELJGS1wrKuLwTC',
                'Origin': 'https://juris.pjud.cl',
                'Referer': referer,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"'
            };
            const { token, cookie } = await GetCookies.create();
            
            while (errorCount < MAX_ERRORES_CONSECUTIVOS) {
                const currentHour = new Date().getHours();
                const payload = await MultipartPayload.create(token, idBuscador, this.elementPerPage, page);

                // Si estamos en horario bloqueado, esperar hasta que termine
                if (currentHour >= this.HORARIO_BLOQUEADO.inicio && currentHour < this.HORARIO_BLOQUEADO.fin) {
                    console.log(`🕒 Horario bloqueado (${this.HORARIO_BLOQUEADO.inicio}:00 - ${this.HORARIO_BLOQUEADO.fin}:00). Esperando...`);
                    await sleep((this.HORARIO_BLOQUEADO.fin - currentHour) * 60 * 60 * 1000);
                }

                let response;
                try {
                    response = await axios.post(
                        'https://juris.pjud.cl/busqueda/buscar_sentencias',
                        payload,
                        {
                            headers: {
                                ...headers,
                                'Cookie': cookie
                            },
                            timeout: 30000 // Timeout de 30 segundos
                        }
                    );

                    if (!response.data?.response?.docs) {
                        console.log('⚠️ No se encontraron más documentos');
                        break;
                    }

                    if (response.data) {
                        const data = response.data.response.docs;

                        // Procesar documentos secuencialmente para evitar condiciones de carrera
                        for (const doc of data) {
                            const idSentence = doc.id;
                            const metadata = MetadataByType.create(doc, BASE_NAME);
                            const indexarPsql = await IndexarPsql.create(doc, BASE_NAME, metadata, idSentence);
                            if (indexarPsql === 'OK') {
                                await IndexarQdrantV2.create(doc, doc.texto_sentencia, BASE_NAME, metadata);
                                errorCount = 0;
                            } else {
                                errorCount++;
                            }
                            requestCount++;
                        }
                    } else {
                        errorCount++;
                    }
                } catch (e) {
                    console.error(`❌ Error en petición HTTP:`, {
                        status: e.response?.status,
                        statusText: e.response?.statusText,
                        message: e.message
                    });
                    errorCount++;
                }

                // Pausa aleatoria entre peticiones (1 a 10 segundos)
                const delay = Math.floor(Math.random() * 9000) + 1000;
                console.log(`⏳ Esperando ${delay / 1000} segundos antes de la siguiente petición...`);
                await sleep(delay);

                // Pausar cada 10 peticiones por n minutos
                if (requestCount >= this.PAUSA_CADA_PETICIONES) {
                    console.log(`⏸️ Se alcanzaron ${this.PAUSA_CADA_PETICIONES} peticiones. Pausando por ${this.PAUSA_MINUTOS} minutos...`);
                    await sleep(this.PAUSA_MINUTOS * 60 * 1000);
                    requestCount = 0;
                }
                
                page = page + this.elementPerPage;
            }
            if (errorCount >= MAX_ERRORES_CONSECUTIVOS) {
                console.log(`🚨 Se han alcanzado ${errorCount} errores consecutivos. Finalizando base ${BASE_NAME}.`);
            }
            
            console.log(`📊 Base ${BASE_NAME} procesada. Total de páginas: ${page}`);
            return { BASE_NAME, totalPages: page, completed: true };
        } catch (e) {
            console.error("🚨 Error general en CheckLastSentence():", e.message);
            throw new Error("Error al ejecutar la función CheckLastSentence()");
        }
    };
}

module.exports = CheckLastSentence