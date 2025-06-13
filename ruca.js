const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const IndexarPinecone2 = require('./functions/IndexarPinecone2');

const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { loadQAStuffChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const { Pinecone } = require("@pinecone-database/pinecone");

require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URL;
const client = new MongoClient(uri);

const BASE_BJUD_URL = process.env.BASE_BJUD_URL
const ID_BUSCADOR = process.env.ID_BUSCADOR
const ELEMENT_PER_PAGE = parseInt(process.env.ELEMENT_PER_PAGE)
const PAGE = parseInt(process.env.PAGE)
const FINAL_PAGE = parseInt(process.env.FINAL_PAGE)

const config = {
    PINECONE: {
        API_KEY: process.env.PINECONE_API_KEY // Asegúrate de tener esta variable de entorno
    }
};

const instruction = "Eres un asistente jurídico especializado en sentencias judiciales. Responde de manera precisa y fundamentada basándote únicamente en la información proporcionada en el contexto.";

const res = [
    '3572898', '3572909',
    '3572933', '3572935',
    '3572949', '3572951',
    '3572960', '3572962'
]

async function getCookies() {
    const urlBase = "https://juris.pjud.cl/busqueda?Sentencias_Civiles";

    try {
        const axiosInstance = axios.create({
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            },
        });

        const response = await axiosInstance.get(urlBase);
        if (response.status != 200) console.error("Error al obtener la página:", response.status, response.statusText);

        const $ = cheerio.load(response.data);
        const tokenElement = $('input[name="_token"]').val();

        if (!tokenElement) console.error("No se encontró el token en la página");

        const token = tokenElement;
        const rawCookies = response.headers['set-cookie'];

        if (!rawCookies) console.error("No se encontraron cookies en la respuesta");

        const cookies = {};
        rawCookies.forEach((cookieString) => {
            const [cookiePair] = cookieString.split(';');
            const [key, value] = cookiePair.split('=');
            cookies[key.trim()] = value.trim();
        });

        const cookieString = `PHPSESSID=${cookies.PHPSESSID}; XSRF-TOKEN=${cookies["XSRF-TOKEN"]}; base_jurisprudencial_del_poder_judicial_session=${cookies.base_jurisprudencial_del_poder_judicial_session}`;

        return {
            token: token,
            cookie: cookieString
        }
    } catch (e) {
        console.error("Error al obtener el token y las cookies:", e.message);
    }
}

// Cache para cookies con timestamp
let cookieCache = {
    token: null,
    cookie: null,
    timestamp: 0,
    duration: 6000000 // 6000 segundos en milisegundos
};

async function getValidCookies() {
    const now = Date.now();
    
    // Si no hay cookies o han expirado, obtener nuevas
    if (!cookieCache.token || !cookieCache.cookie || (now - cookieCache.timestamp) > cookieCache.duration) {
        console.log('🔄 Obteniendo nuevas cookies...');
        const { token, cookie } = await getCookies();
        
        cookieCache = {
            token,
            cookie,
            timestamp: now,
            duration: 6000000
        };
        
        console.log('✅ Cookies actualizadas');
    } else {
        const remainingTime = Math.round((cookieCache.duration - (now - cookieCache.timestamp)) / 1000);
        console.log(`♻️ Reutilizando cookies existentes (válidas por ${remainingTime}s más)`);
    }
    
    return {
        token: cookieCache.token,
        cookie: cookieCache.cookie
    };
}

// Función para crear el payload multipart de forma más eficiente
function createMultipartPayload(token, idBuscador, elementPerPage, page) {
    const boundary = '----WebKitFormBoundaryIoELJGS1wrKuLwTC';
    const filtros = JSON.stringify({
        "rol": "",
        "era": "",
        "fec_desde": "",
        "fec_hasta": "",
        "tipo_norma": "",
        "num_norma": "",
        "num_art": "",
        "num_inciso": "",
        "todas": "",
        "algunas": "",
        "excluir": "",
        "literal": "",
        "proximidad": "",
        "distancia": "",
        "analisis_s": "11",
        "submaterias": "",
        "facetas_seleccionadas": "",
        "filtros_omnibox": [{"categoria": "TEXTO", "valores": [""]}],
        "ids_comunas_seleccionadas_mapa": []
    });

    return [
        `--${boundary}`,
        'Content-Disposition: form-data; name="_token"',
        '',
        token,
        `--${boundary}`,
        'Content-Disposition: form-data; name="id_buscador"',
        '',
        idBuscador,
        `--${boundary}`,
        'Content-Disposition: form-data; name="filtros"',
        '',
        filtros,
        `--${boundary}`,
        'Content-Disposition: form-data; name="numero_filas_paginacion"',
        '',
        elementPerPage.toString(),
        `--${boundary}`,
        'Content-Disposition: form-data; name="offset_paginacion"',
        '',
        page.toString(),
        `--${boundary}`,
        'Content-Disposition: form-data; name="orden"',
        '',
        'rel',
        `--${boundary}--`
    ].join('\r\n');
}

async function getData(idBuscadorBase, refererUrl) {
    const start = new Date();
    try {
        let finalPage = FINAL_PAGE;
        let elementPerPage = ELEMENT_PER_PAGE; // Aumentado de 10 a 50 para menos requests
        let page = PAGE;
        let processedCount = 0;
        let duplicateCount = 0;

        // Crear directorio sentencias una sola vez al inicio
        const sentenciasDir = path.join(__dirname, 'sentencias');
        if (!fs.existsSync(sentenciasDir)) {
            fs.mkdirSync(sentenciasDir, { recursive: true });
        }

        // Obtener lista de archivos existentes para evitar duplicados
        const existingFiles = new Set(
            fs.readdirSync(sentenciasDir)
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''))
        );

        console.log(`📂 Archivos existentes: ${existingFiles.size}`);

        // Constantes para la request
        const idBuscador = idBuscadorBase;
        const referer = refererUrl;
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

        while (page < finalPage) {
            try {
                // Obtener cookies válidas
                const { token, cookie } = await getValidCookies();
                
                console.log(`📄 Procesando página ${Math.floor(page/elementPerPage) + 1} (offset: ${page})`);

                const payload = createMultipartPayload(token, idBuscador, elementPerPage, page);
                
                const response = await axios.post(
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

                const sentencias = response.data.response.docs;
                // finalPage = response.data.response.numFound;

                console.log(`📊 Total encontrado: ${finalPage}, Página actual: ${sentencias.length} sentencias`);

                // Procesar sentencias en lote
                const newSentencias = [];
                for (const sentencia of sentencias) {
                    if (!existingFiles.has(sentencia.id)) {
                        newSentencias.push(sentencia);
                        existingFiles.add(sentencia.id); // Actualizar el set
                    } else {
                        duplicateCount++;
                    }
                }

                // Escribir archivos solo para sentencias nuevas
                if (newSentencias.length > 0) {
                    const writePromises = newSentencias.map(sentencia => {
                        const fileName = path.join(sentenciasDir, `${sentencia.id}.json`);
                        return fs.promises.writeFile(fileName, JSON.stringify(sentencia, null, 2));
                    });

                    await Promise.all(writePromises);
                    processedCount += newSentencias.length;
                    console.log(`✅ ${newSentencias.length} sentencias nuevas guardadas (${duplicateCount} duplicadas omitidas)`);
                } else {
                    console.log(`⚠️ Todas las sentencias de esta página ya existen`);
                }

                page += elementPerPage;

                // Si no hay más páginas, salir
                if (page >= finalPage) {
                    break;
                }

                // Pausa adaptativa: menos tiempo si hay muchas sentencias nuevas
                const pauseTime = newSentencias.length > 0 ? 1500 : 3000;
                console.log(`⏳ Esperando ${pauseTime/1000}s antes de la siguiente página...`);
                await new Promise(resolve => setTimeout(resolve, pauseTime));

            } catch (error) {
                console.error(`❌ Error en página ${Math.floor(page/elementPerPage) + 1}:`, error.message);
                
                // Si es error de timeout o red, esperar más tiempo
                if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                    console.log('⏳ Error de conexión, esperando 10 segundos...');
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
                
                page += elementPerPage; // Continuar con la siguiente página
            }
        }

        const totalFiles = fs.readdirSync(sentenciasDir).filter(f => f.endsWith('.json')).length;
        console.log(`🎉 Proceso completado:`);
        console.log(`   📁 Total archivos: ${totalFiles}`);
        console.log(`   ✅ Nuevos procesados: ${processedCount}`);
        console.log(`   ⚠️ Duplicados omitidos: ${duplicateCount}`);
        console.log(`   ⏳ Tiempo de ejecución: ${new Date() - start}ms`);
    } catch (e) {
        console.error(`❌ Error general al obtener los datos: ${e.message}`);
        console.error(e.stack);
    }
}

// TODO: aun sin uso
async function sessionConnection() {
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

async function indexarTodasLasSentencias() {
    try {
        const sentenciasDir = path.join(__dirname, 'sentencias');

        // Verificar si la carpeta existe
        if (!fs.existsSync(sentenciasDir)) {
            console.log('❌ La carpeta sentencias no existe');
            return;
        }

        // Leer todos los archivos de la carpeta
        const archivos = fs.readdirSync(sentenciasDir).filter(archivo => archivo.endsWith('.json'));

        if (archivos.length === 0) {
            console.log('⚠️ No se encontraron archivos JSON en la carpeta sentencias');
            return;
        }

        console.log(`📂 Procesando ${archivos.length} sentencias para indexar...`);

        for (const archivo of archivos) {
            try {
                const rutaArchivo = path.join(sentenciasDir, archivo);
                const contenido = fs.readFileSync(rutaArchivo, 'utf8');
                const jsonData = JSON.parse(contenido);

                console.log(`🔄 Indexando sentencia: ${archivo}`);
                const metadata = {
                    idSentence: parseInt(jsonData.id),
                    base: jsonData.sent__base_s,
                    sala: jsonData.gls_sala_sup_s,
                    corte: jsonData.gls_corte_s,
                    era: jsonData.era_sup_i,
                    categorizacion: jsonData.sent__categorizacion_s,
                    fechaSentencia: jsonData.fec_sentencia_sup_dt,
                    rol: jsonData.rol_era_sup_s,
                    caratulado: jsonData.caratulado_s,
                    resultado: jsonData.resultado_recurso_sup_s,
                    redactor: jsonData.gls_redactor_s,
                    ministro: jsonData.gls_ministro_ss,
                    tipoRecurso: jsonData.gls_tip_recurso_sup_s,
                    descriptores: jsonData.gls_descriptor_ss,
                    idNorm: jsonData.id_norma_ss,
                    articulo: jsonData.norma_articulo_ss,
                    url: jsonData.url_corta_acceso_sentencia,

                }
                await IndexarPinecone2.create(jsonData.texto_sentencia, 'bigdata', 'sentencias', metadata);
                console.log(`✅ Sentencia ${archivo} indexada correctamente`);

                // Pausa pequeña entre indexaciones para evitar saturar el servicio
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`❌ Error al procesar ${archivo}:`, error.message);
            }
        }

        console.log('🎉 Indexación de todas las sentencias completada');

    } catch (error) {
        console.error('❌ Error general al indexar sentencias:', error.message);
    }
}

getData(ID_BUSCADOR, BASE_BJUD_URL)

// indexarTodasLasSentencias();


const chat = async (model, temperature, indexName, namespace, topK, metadata, userMessage) => {
    try {
        const pc = new Pinecone({ apiKey: config.PINECONE.API_KEY });
        const llm = new ChatOpenAI({ model: model, temperature: temperature });
        const queryEmbedding = await new OpenAIEmbeddings({ model: 'text-embedding-3-large', dimensions: 3072 }).embedQuery(userMessage);

        const index = pc.index(indexName);

        const prompt = PromptTemplate.fromTemplate(`${instruction}. {context} pregunta: {input}`);
        const chain = loadQAStuffChain(llm, { prompt: prompt });

        let queryResponse = await index.namespace(namespace).query({
            vector: queryEmbedding,
            topK: topK,
            // filter: metadata,
            includeMetadata: true,
        });

        const concatenatedText = queryResponse.matches.map((match) => JSON.stringify(match.metadata)).join(" \n\n");
        // const concatenatedText = queryResponse.matches.map((match) => match.metadata.text).join(" \n\n");

        // Crear mapa para eliminar duplicados y mantener el score más alto
        const uniqueChunks = new Map();

        queryResponse.matches.forEach((match) => {
            const chunkContent = JSON.stringify(match.metadata.text);
            const currentScore = match.score;

            // Si no existe o el score actual es mayor, actualizar
            if (!uniqueChunks.has(chunkContent) || uniqueChunks.get(chunkContent).score < currentScore) {
                uniqueChunks.set(chunkContent, {
                    score: currentScore,
                    chunk: chunkContent,
                    metadata: match.metadata
                });
            }
        });

        // Convertir el Map a array y ordenar por score descendente
        const concatenatedTextWithScore = Array.from(uniqueChunks.values())
            .sort((a, b) => b.score - a.score);

        const result = await chain.invoke({
            input_documents: [{ pageContent: concatenatedText }],
            input: userMessage,
        });

        return {
            result: result.text,
            concatenatedTextWithScore: concatenatedTextWithScore,
            // queryResponse: queryResponse.matches,
            // concatenatedText: concatenatedText,
        };
    } catch (e) {
        console.error("🚨 Error en función chat:", e.message);
        throw e;
    }
}

// Función principal para ejecutar el chat
async function ejecutarChat() {
    try {
        console.log("🤖 Iniciando consulta al chat...");
        const resultado = await chat('gpt-4o-mini', 0, 'bigdata', 'sentencias', 10, {}, '¿en que sentencia habla del amparado adolecente?');
        console.log("📝 Respuesta:", resultado);
        fs.writeFileSync('resultado.json', JSON.stringify(resultado, null, 2));
    } catch (error) {
        console.error("❌ Error al ejecutar chat:", error.message);
    }
}

// Ejecutar el chat
// ejecutarChat();

async function indexarMongo(dbName, collection) {
    try {
        const sentenciasDir = path.join(__dirname, 'sentencias');

        // Verificar si la carpeta existe
        if (!fs.existsSync(sentenciasDir)) {
            console.log('❌ La carpeta sentencias no existe');
            return;
        }

        // Leer todos los archivos de la carpeta
        const archivos = fs.readdirSync(sentenciasDir).filter(archivo => archivo.endsWith('.json'));

        if (archivos.length === 0) {
            console.log('⚠️ No se encontraron archivos JSON en la carpeta sentencias');
            return;
        }

        console.log(`📂 Procesando ${archivos.length} sentencias para indexar en MongoDB...`);

        await client.connect();
        const db = client.db(dbName);
        const collectionDb = db.collection(collection);

        for (const archivo of archivos) {
            try {
                const rutaArchivo = path.join(sentenciasDir, archivo);
                const contenido = fs.readFileSync(rutaArchivo, 'utf8');
                const jsonData = JSON.parse(contenido);

                // Verificar si la sentencia ya existe
                if (await collectionDb.countDocuments({ id: jsonData.id }) > 0) {
                    console.log(`⚠️ La sentencia con ID ${jsonData.id} ya existe en la colección.`);
                    continue;
                }

                console.log(`🔄 Indexando sentencia en MongoDB: ${archivo}`);

                const entrada = {
                    sentenceId: parseInt(jsonData.id),
                    base: jsonData.sent__base_s,
                    sala: jsonData.gls_sala_sup_s,
                    corte: jsonData.gls_corte_s,
                    era: jsonData.era_sup_i,
                    categorizacion: jsonData.sent__categorizacion_s,
                    fechaSentencia: jsonData.fec_sentencia_sup_dt,
                    rol: jsonData.rol_era_sup_s,
                    caratulado: jsonData.caratulado_s,
                    resultado: jsonData.resultado_recurso_sup_s,
                    redactor: jsonData.gls_redactor_s,
                    ministro: jsonData.gls_ministro_ss,
                    tipoRecurso: jsonData.gls_tip_recurso_sup_s,
                    descriptores: jsonData.gls_descriptor_ss,
                    idNorm: jsonData.id_norma_ss,
                    articulo: jsonData.norma_articulo_ss,
                    url: jsonData.url_corta_acceso_sentencia,
                    textoSentencia: jsonData.texto_sentencia,
                    fechaCreacion: new Date(),
                    data: jsonData // Guardar todos los datos originales
                };

                await collectionDb.insertOne(entrada);
                console.log(`✅ Sentencia ${archivo} indexada correctamente en MongoDB`);

                // Pausa pequeña entre indexaciones para evitar saturar el servicio
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.error(`❌ Error al procesar ${archivo}:`, error.message);
            }
        }

        console.log('🎉 Indexación de todas las sentencias en MongoDB completada');

    } catch (e) {
        console.error('❌ Error general al indexar sentencias en MongoDB:', e.message);
    } finally {
        await client.close();
    }
}

// indexarMongo('buscadorDB', 'sentencias');