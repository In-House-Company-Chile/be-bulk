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
const BASE_NAME = process.env.BASE_NAME


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
    "filtros_omnibox": [{ "categoria": "TEXTO", "valores": [""] }],
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
    let elementPerPage = ELEMENT_PER_PAGE;
    let page = PAGE;
    let processedCount = 0;

    // Archivo de log para guardar el progreso
    const logFile = path.join(__dirname, 'progress.log');

    // Función para guardar el progreso
    function saveProgress(currentPage, totalProcessed, status = 'PROCESSING') {
      const logData = {
        timestamp: new Date().toISOString(),
        currentPage: currentPage,
        offset: currentPage,
        pageNumber: Math.floor(currentPage / elementPerPage) + 1,
        totalProcessed: totalProcessed,
        elementPerPage: elementPerPage,
        finalPage: finalPage,
        status: status
      };

      try {
        fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
        console.log(`💾 Progreso guardado - Página: ${logData.pageNumber}, Offset: ${currentPage}, Procesados: ${totalProcessed}`);
      } catch (error) {
        console.error('❌ Error guardando progreso:', error.message);
      }
    }

    // Función para cargar el progreso anterior
    function loadProgress() {
      try {
        if (fs.existsSync(logFile)) {
          const logData = JSON.parse(fs.readFileSync(logFile, 'utf8'));
          console.log(`📂 Progreso anterior encontrado:`);
          console.log(`   📄 Última página: ${logData.pageNumber} (offset: ${logData.currentPage})`);
          console.log(`   ✅ Total procesado: ${logData.totalProcessed}`);
          console.log(`   📅 Fecha: ${logData.timestamp}`);
          console.log(`   📊 Estado: ${logData.status}`);

          // Reanudar si el proceso fue interrumpido (no completado exitosamente)
          if (logData.status === 'PROCESSING' ||
            logData.status === 'FAILED_MAX_RETRIES' ||
            logData.status === 'FAILED_CRITICAL_ERROR' ||
            logData.status === 'ERROR' ||
            logData.status === 'INTERRUPTED' ||
            logData.status === 'TERMINATED') {
            console.log(`🔄 Reanudando desde la página ${logData.pageNumber} debido a interrupción anterior...`);
            if (logData.status.includes('FAILED') || logData.status === 'ERROR') {
              console.log(`⚠️ El proceso anterior falló. Reintentando desde la última página guardada.`);
            }
            return {
              page: logData.currentPage,
              processedCount: logData.totalProcessed
            };
          } else if (logData.status === 'COMPLETED') {
            console.log(`✅ Proceso anterior completado exitosamente. Iniciando desde el principio...`);
          } else {
            console.log(`❓ Estado desconocido: ${logData.status}. Iniciando desde el principio...`);
          }
        }
      } catch (error) {
        console.error('⚠️ Error cargando progreso anterior:', error.message);
      }
      return null;
    }

    // Cargar progreso anterior si existe
    const previousProgress = loadProgress();
    if (previousProgress) {
      page = previousProgress.page;
      processedCount = previousProgress.processedCount;
    }

    console.log(`🚀 Iniciando obtención de sentencias desde página ${Math.floor(page / elementPerPage) + 1} (offset: ${page})...`);

    // Guardar estado inicial
    saveProgress(page, processedCount, 'PROCESSING');

    // Manejar interrupción manual del proceso (Ctrl+C)
    let currentPage = page;
    let currentProcessedCount = processedCount;

    process.on('SIGINT', () => {
      console.log(`\n🛑 Interrupción manual detectada (Ctrl+C). Guardando progreso...`);
      saveProgress(currentPage, currentProcessedCount, 'INTERRUPTED');
      console.log(`💾 Progreso guardado. Para reanudar, ejecute el servicio nuevamente.`);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log(`\n🛑 Terminación del proceso detectada. Guardando progreso...`);
      saveProgress(currentPage, currentProcessedCount, 'TERMINATED');
      console.log(`💾 Progreso guardado. Para reanudar, ejecute el servicio nuevamente.`);
      process.exit(0);
    });

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
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Obtener cookies válidas (nuevas en cada reintento)
          const { token, cookie } = await getValidCookies();

          console.log(`📄 Procesando página ${Math.floor(page / elementPerPage) + 1} (offset: ${page})${retryCount > 0 ? ` - Intento ${retryCount + 1}/${maxRetries}` : ''}`);

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
            success = true;
            break;
          }

          const sentencias = response.data.response.docs;

          console.log(`📊 Total encontrado: ${finalPage}, Página actual: ${sentencias.length} sentencias`);

          // Procesar e imprimir cada sentencia individualmente
          for (const sentencia of sentencias) {
            console.log(`\n🔍 === SENTENCIA ID: ${sentencia.id} ===`);
            await indexarSentenciasFromData([sentencia], 'buscadorDB', 'jurisprudencia', BASE_NAME, { indexPinecone: true, indexMongo: true });
            console.log(`=== FIN SENTENCIA ${sentencia.id} ===\n`);
            processedCount++;
          }

          console.log(`✅ ${sentencias.length} sentencias procesadas en esta página`);

          success = true; // Marcar como exitoso
          page += elementPerPage;

          // Actualizar variables para los manejadores de señales
          currentPage = page;
          currentProcessedCount = processedCount;

          // Guardar progreso después de procesar cada página exitosamente
          saveProgress(page, processedCount, 'PROCESSING');

          // Si no hay más páginas, salir
          if (page >= finalPage) {
            break;
          }

          // Pausa entre páginas
          const pauseTime = 2000;
          console.log(`⏳ Esperando ${pauseTime / 1000}s antes de la siguiente página...`);
          await new Promise(resolve => setTimeout(resolve, pauseTime));

        } catch (error) {
          retryCount++;
          console.error(`❌ Error en página ${Math.floor(page / elementPerPage) + 1} (intento ${retryCount}/${maxRetries}):`, error.message);

          // Si es error de timeout o red
          if (retryCount < maxRetries) {
            console.log(`🔄 Reintentando con nuevas cookies en 5 segundos...`);
            // Invalidar cache de cookies para forzar nuevas cookies
            cookieCache.timestamp = 0;
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            console.error(`💥 Se agotaron los ${maxRetries} intentos para la página ${Math.floor(page / elementPerPage) + 1}. DETENIENDO SERVICIO COMPLETAMENTE.`);
            // Guardar progreso antes de terminar por timeout
            saveProgress(page, processedCount, 'FAILED_MAX_RETRIES');
            console.log(`🛑 SERVICIO DETENIDO - Resumen final:`);
            console.log(`   ✅ Total procesados: ${processedCount}`);
            console.log(`   ⏳ Tiempo de ejecución: ${new Date() - start}ms`);
            console.log(`   📄 Última página procesada: ${Math.floor(page / elementPerPage)}`);
            console.log(`   🔄 Para reanudar, ejecute el servicio nuevamente - se reanudará automáticamente desde esta página.`);

            // Forzar salida completa del proceso
            process.exit(1);
          }
        }
      }

      // Si no se logró éxito después de todos los reintentos (redundancia de seguridad)
      if (!success && retryCount >= maxRetries) {
        console.error(`🛑 FALLO CRÍTICO: No se pudo procesar la página después de ${maxRetries} intentos. DETENIENDO SERVICIO.`);
        saveProgress(page, processedCount, 'FAILED_MAX_RETRIES');
        process.exit(1);
      }
    }

    // Guardar estado final como completado
    saveProgress(page, processedCount, 'COMPLETED');

    console.log(`🎉 Proceso completado:`);
    console.log(`   ✅ Total procesados: ${processedCount}`);
    console.log(`   ⏳ Tiempo de ejecución: ${new Date() - start}ms`);
  } catch (e) {
    // Guardar progreso antes de terminar por error
    try {
      const logFile = path.join(__dirname, 'progress.log');
      const logData = {
        timestamp: new Date().toISOString(),
        currentPage: page,
        offset: page,
        pageNumber: Math.floor(page / elementPerPage) + 1,
        totalProcessed: processedCount,
        elementPerPage: elementPerPage,
        finalPage: finalPage,
        status: 'ERROR',
        error: e.message
      };
      fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
      console.log(`💾 Progreso guardado antes del error - Página: ${logData.pageNumber}, Procesados: ${processedCount}`);
    } catch (logError) {
      console.error('❌ Error guardando progreso final:', logError.message);
    }

    console.error(`❌ Error general al obtener los datos: ${e.message}`);
    console.error(e.stack);
  }
}


/**
 * Función mejorada para indexar sentencias desde objetos de datos directamente
 * @param {Array} sentenciasData - Array de objetos con los datos de las sentencias
 * @param {string} dbName - Nombre de la base de datos
 * @param {string} collection - Nombre de la colección
 * @param {string} tipoBase - Tipo de base (ej: 'civil', 'penal', 'familia', etc.)
 * @param {Object} options - Opciones adicionales { indexPinecone: boolean, indexMongo: boolean }
 */
async function indexarSentenciasFromData(sentenciasData, dbName, collection, tipoBase, options = { indexPinecone: true, indexMongo: true }) {
  try {
    // Validar parámetros
    if (!Array.isArray(sentenciasData) || sentenciasData.length === 0) {
      console.log('❌ No se proporcionaron datos de sentencias válidos');
      return { success: false, message: 'No hay datos para procesar' };
    }

    if (!dbName || !collection) {
      console.log('❌ dbName y collection son requeridos');
      return { success: false, message: 'Parámetros dbName y collection son requeridos' };
    }

    console.log(`🚀 Iniciando indexación de ${sentenciasData.length} sentencias...`);
    console.log(`📊 Configuración:`);
    console.log(`   🗄️ Base de datos: ${dbName}`);
    console.log(`   📁 Colección: ${collection}`);
    console.log(`   🏷️ Tipo de base: ${tipoBase}`);
    console.log(`   🔍 Indexar en Pinecone: ${options.indexPinecone ? '✅' : '❌'}`);
    console.log(`   🍃 Indexar en MongoDB: ${options.indexMongo ? '✅' : '❌'}`);

    let processedCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let mongoClient = null;
    let collectionDb = null;

    // Conectar a MongoDB SIEMPRE para validar duplicados
    // (independientemente de si se va a indexar en MongoDB o no)
    try {
      await client.connect();
      const db = client.db(dbName);
      collectionDb = db.collection(collection);
      mongoClient = client;
      console.log(`✅ Conectado a MongoDB: ${dbName}.${collection}`);
    } catch (error) {
      console.error('❌ Error conectando a MongoDB:', error.message);
      return { success: false, message: 'Error de conexión a MongoDB - Requerida para validar duplicados' };
    }

    // Procesar cada sentencia
    for (let i = 0; i < sentenciasData.length; i++) {
      const jsonData = sentenciasData[i];

      try {
        console.log(`🔄 Procesando sentencia ${i + 1}/${sentenciasData.length} - ID: ${jsonData.id}`);

        // VALIDACIÓN PRINCIPAL: Verificar si la sentencia ya existe en MongoDB
        // Esta validación se hace SIEMPRE, independientemente de si se va a indexar en MongoDB o no
        if (collectionDb) {
          const existingDoc = await collectionDb.countDocuments({
            $or: [
              { idSentence: jsonData.id },
            ]
          });

          if (existingDoc > 0) {
            console.log(`⚠️ La sentencia con ID ${jsonData.id} ya existe en MongoDB - Saltando completamente`);
            duplicateCount++;
            continue; // Saltar al siguiente item sin procesar ni MongoDB ni Pinecone
          }
        } else if (options.indexMongo) {
          // Si se requiere indexar en MongoDB pero no hay conexión, es un error
          console.error(`❌ Se requiere indexar en MongoDB pero no hay conexión disponible`);
          errorCount++;
          continue;
        }

        // Crear metadata según el tipo de base
        const metadata = createMetadataByType(jsonData, tipoBase);

        // Indexar en Pinecone si está habilitado
        if (options.indexPinecone && jsonData.texto_sentencia) {
          try {
            await IndexarPinecone2.create(jsonData.texto_sentencia, 'bigdata', 'jurisprudencia', metadata);
            console.log(`✅ Sentencia ${jsonData.id} indexada en Pinecone`);
          } catch (pineconeError) {
            console.error(`❌ Error indexando en Pinecone (ID: ${jsonData.id}):`, pineconeError.message);
            errorCount++;
          }
        }

        // Indexar en MongoDB si está habilitado
        if (options.indexMongo && collectionDb) {
          try {
            const entrada = createMongoEntry(jsonData, tipoBase);
            await collectionDb.insertOne(entrada);
            console.log(`✅ Sentencia ${jsonData.id} indexada en MongoDB`);
          } catch (mongoError) {
            console.error(`❌ Error indexando en MongoDB (ID: ${jsonData.id}):`, mongoError.message);
            errorCount++;
          }
        }

        processedCount++;

        // Pausa pequeña entre indexaciones para evitar saturar el servicio
        if (i < sentenciasData.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`❌ Error procesando sentencia ${jsonData.id || 'ID desconocido'}:`, error.message);
        errorCount++;
      }
    }

    // Cerrar conexión de MongoDB
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 Conexión a MongoDB cerrada');
    }

    // Resumen final
    console.log(`\n🎉 Indexación completada:`);
    console.log(`   ✅ Procesadas exitosamente: ${processedCount}`);
    console.log(`   ⚠️ Duplicadas omitidas: ${duplicateCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📊 Total: ${sentenciasData.length}`);

    return {
      success: true,
      processed: processedCount,
      duplicates: duplicateCount,
      errors: errorCount,
      total: sentenciasData.length
    };

  } catch (error) {
    console.error('❌ Error general al indexar sentencias:', error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Crear metadata según el tipo de base
 */
function createMetadataByType(jsonData, tipoBase) {
  const baseMetadata = {
    idSentence: jsonData.id,
    base: tipoBase,
    url: jsonData.url_corta_acceso_sentencia || '',
  };

  switch (tipoBase.toLowerCase()) {
    case 'civil':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
        materia: jsonData.gls_materia_s || '',
      };

    case 'penal':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.gls_materia_ss || [],
        juez: jsonData.gls_juez_ss || [],
        resultado: jsonData.sent__GLS_DECISION_s || '',
      };

    case 'familia':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.cod_materia_s || [],
        juez: jsonData.gls_juez_ss || [],
      };

    case 'salud_corte_de_apelaciones':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_ape_s || '',
        caratulado: jsonData.caratulado_s || '',
        corte: jsonData.gls_corte_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tematicaDeSalud: jsonData.tematica_ss || [],
        era: jsonData.era_sup_i || 0,
        isapre: jsonData.isapre_ss || [],
      };

    case 'salud_corte_suprema':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        institucionesRecurridas: jsonData.organismo_ss || [],
        tematicaDeSalud: jsonData.tematica_ss || [],
        medicamento: jsonData.medicamento_ss || [],
        enfermedad: jsonData.enfermedad_ss || [],
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        era: jsonData.era_sup_i || 0,
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || ''
      };

    case 'cobranza':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };

    case 'corte_suprema':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.sent__categorizacion_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        redactor: jsonData.gls_relator_s || '',
        ministro: jsonData.gls_ministro_ss || [],
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || '',
        descriptores: jsonData.gls_descriptor_ss || [],
        idNorm: jsonData.id_norma_ss || [],
        articulo: jsonData.norma_articulo_ss || [],
      };

    case 'laboral':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || [],
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };

    case 'corte_de_apelaciones':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tipoRecurso: jsonData.tip_recurso_s || '',
        juez: jsonData.gls_juez_s || '',
      };

    default:
      // Metadata genérico
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };
  }
}

/**
 * Crear entrada para MongoDB según el tipo de base
 */
function createMongoEntry(jsonData, tipoBase) {
  const baseEntry = {
    idSentence: jsonData.id,
    base: tipoBase,
    url: jsonData.url_corta_acceso_sentencia || '',
    data: jsonData,
    fechaCreacion: new Date()
  };

  switch (tipoBase.toLowerCase()) {
    case 'civil':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
        materia: jsonData.gls_materia_s || '',
      };

    case 'penal':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.gls_materia_ss || [],
        juez: jsonData.gls_juez_ss || [],
        resultado: jsonData.sent__GLS_DECISION_s || '',
      };

    case 'familia':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.cod_materia_s || [],
        juez: jsonData.gls_juez_ss || [],
      };

    case 'salud_corte_de_apelaciones':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_ape_s || '',
        caratulado: jsonData.caratulado_s || '',
        corte: jsonData.gls_corte_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tematicaDeSalud: jsonData.tematica_ss || [],
        era: jsonData.era_sup_i || 0,
        isapre: jsonData.isapre_ss || [],
      };

    case 'salud_corte_suprema':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        institucionesRecurridas: jsonData.organismo_ss || [],
        tematicaDeSalud: jsonData.tematica_ss || [],
        medicamento: jsonData.medicamento_ss || [],
        enfermedad: jsonData.enfermedad_ss || [],
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        era: jsonData.era_sup_i || 0,
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || ''
      };

    case 'cobranza':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || [],
      };

    case 'corte_suprema':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.sent__categorizacion_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        redactor: jsonData.gls_relator_s || '',
        ministro: jsonData.gls_ministro_ss || [],
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || '',
        descriptores: jsonData.gls_descriptor_ss || [],
        idNorm: jsonData.id_norma_ss || [],
        articulo: jsonData.norma_articulo_ss || [],
      };

    case 'laboral':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || [],
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };

    case 'corte_de_apelaciones':
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tipoRecurso: jsonData.tip_recurso_s || '',
        juez: jsonData.gls_juez_s || '',
      };

    default:
      // Entrada genérica
      return {
        ...baseEntry,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };
  }
}

// indexarTodasLasSentencias();
// indexarMongo('buscadorDB', 'jurisprudencia');

// Ejemplo de uso de la nueva función:
// const sentenciasArray = [sentencia1, sentencia2, sentencia3];
// indexarSentenciasFromData(sentenciasArray, 'buscadorDB', 'jurisprudencia', 'civil', { indexPinecone: true, indexMongo: true });

// getData(ID_BUSCADOR, BASE_BJUD_URL)


// CONFIGURACIONES DE OPTIMIZACIÓN PARA DIFERENTES ESCENARIOS
const MONGO_OPTIMIZATION_CONFIGS = {
  // Para cargas muy pesadas (>100k documentos)
  HEAVY_LOAD: {
    BATCH_SIZE: 200,
    MAX_POOL_SIZE: 30,
    MIN_POOL_SIZE: 10,
    WRITE_CONCERN: { w: 1, j: false },
    BATCH_PAUSE_MS: 50
  },
  
  // Para cargas medianas (10k-100k documentos)
  MEDIUM_LOAD: {
    BATCH_SIZE: 100,
    MAX_POOL_SIZE: 20,
    MIN_POOL_SIZE: 5,
    WRITE_CONCERN: { w: 1, j: false },
    BATCH_PAUSE_MS: 100
  },
  
  // Para cargas ligeras (<10k documentos)
  LIGHT_LOAD: {
    BATCH_SIZE: 50,
    MAX_POOL_SIZE: 10,
    MIN_POOL_SIZE: 2,
    WRITE_CONCERN: { w: 1, j: true },
    BATCH_PAUSE_MS: 200
  }
};

// Detectar automáticamente el tipo de carga basado en número de archivos
function getOptimalConfig(totalFiles) {
  if (totalFiles > 100000) {
    console.log('🔥 Configuración HEAVY_LOAD detectada (>100k archivos)');
    return MONGO_OPTIMIZATION_CONFIGS.HEAVY_LOAD;
  } else if (totalFiles > 10000) {
    console.log('⚡ Configuración MEDIUM_LOAD detectada (10k-100k archivos)');
    return MONGO_OPTIMIZATION_CONFIGS.MEDIUM_LOAD;
  } else {
    console.log('💡 Configuración LIGHT_LOAD detectada (<10k archivos)');
    return MONGO_OPTIMIZATION_CONFIGS.LIGHT_LOAD;
  }
}

/**
 * Función auxiliar para monitorear rendimiento de indexación
 */
function createPerformanceMonitor() {
    const startTime = Date.now();
    let lastBatchTime = startTime;
    let totalProcessed = 0;

    return {
        logBatchPerformance: (batchSize, batchNumber, totalBatches) => {
            const now = Date.now();
            const batchTime = now - lastBatchTime;
            const totalTime = now - startTime;
            
            totalProcessed += batchSize;
            
            const batchRate = batchSize / (batchTime / 1000);
            const overallRate = totalProcessed / (totalTime / 1000);
            const estimatedTimeRemaining = ((totalBatches - batchNumber) * (totalTime / batchNumber)) / 1000;

            console.log(`⚡ Rendimiento del lote ${batchNumber}/${totalBatches}:`);
            console.log(`   📊 Velocidad del lote: ${batchRate.toFixed(2)} docs/seg`);
            console.log(`   📈 Velocidad promedio: ${overallRate.toFixed(2)} docs/seg`);
            console.log(`   ⏱️ Tiempo estimado restante: ${Math.round(estimatedTimeRemaining)}s`);
            console.log(`   💾 Total procesado: ${totalProcessed} documentos`);

            lastBatchTime = now;
        },

        getFinalStats: (totalProcessed, totalErrors, totalDuplicates) => {
            const totalTime = Date.now() - startTime;
            const overallRate = totalProcessed / (totalTime / 1000);
            
            return {
                totalTime: Math.round(totalTime / 1000),
                overallRate: overallRate.toFixed(2),
                totalProcessed,
                totalErrors,
                totalDuplicates
            };
        }
    };
}

async function indexarMongo(dbName, collection) {
  try {
      const sentenciasDir = `/root/${BASE_NAME}`;
      const successDir = path.join(sentenciasDir, 'success');

      // Verificar si la carpeta existe
      if (!fs.existsSync(sentenciasDir)) {
          console.log('❌ La carpeta de sentencias no existe');
          return;
      }

      // Crear carpeta success si no existe
      if (!fs.existsSync(successDir)) {
          fs.mkdirSync(successDir, { recursive: true });
          console.log(`📁 Carpeta success creada: ${successDir}`);
      }

      // Leer todos los archivos de la carpeta
      const archivos = fs.readdirSync(sentenciasDir).filter(archivo => 
          archivo.endsWith('.json') && fs.statSync(path.join(sentenciasDir, archivo)).isFile()
      );

      if (archivos.length === 0) {
          console.log('⚠️ No se encontraron archivos JSON en la carpeta de sentencias');
          return;
      }

      console.log(`📂 Procesando ${archivos.length} sentencias para indexar en MongoDB...`);
      console.log(`🏷️ Tipo de base desde variable de entorno: ${BASE_NAME}`);
      console.log(`📁 Carpeta origen: ${sentenciasDir}`);
      console.log(`✅ Carpeta destino (éxito): ${successDir}`);

      // OPTIMIZACIÓN 1: Configurar conexión MongoDB con opciones optimizadas dinámicamente
      const optimalConfig = getOptimalConfig(archivos.length);
      
      const mongoOptions = {
          maxPoolSize: optimalConfig.MAX_POOL_SIZE,
          minPoolSize: optimalConfig.MIN_POOL_SIZE,
          maxIdleTimeMS: 30000,      // Tiempo máximo inactivo
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          bufferMaxEntries: 0,       // Deshabilitar buffering
          retryWrites: true,
          writeConcern: optimalConfig.WRITE_CONCERN
      };

      const optimizedClient = new MongoClient(uri, mongoOptions);
      await optimizedClient.connect();
      const db = optimizedClient.db(dbName);
      const collectionDb = db.collection(collection);

      // OPTIMIZACIÓN 2: Crear índice para mejorar las consultas de duplicados
      try {
          await collectionDb.createIndex({ idSentence: 1 }, { background: true, unique: true });
          console.log('📊 Índice en idSentence creado/verificado');
      } catch (indexError) {
          // El índice ya existe o hay otro error, continuar
          console.log('📊 Índice en idSentence ya existe o error menor:', indexError.message);
      }

      // OPTIMIZACIÓN 3: Obtener todos los IDs existentes de una vez
      console.log('🔍 Obteniendo IDs existentes para verificación de duplicados...');
      const existingIds = new Set();
      const cursor = collectionDb.find({}, { projection: { idSentence: 1, _id: 0 } });
      await cursor.forEach(doc => {
          if (doc.idSentence) existingIds.add(doc.idSentence.toString());
      });
      console.log(`📋 ${existingIds.size} IDs existentes cargados en memoria`);

      let processedCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      let movedCount = 0;

      // OPTIMIZACIÓN 4: Procesamiento en lotes (bulk operations) - tamaño dinámico
      const BATCH_SIZE = optimalConfig.BATCH_SIZE;
      const archivosEnLotes = [];
      
      for (let i = 0; i < archivos.length; i += BATCH_SIZE) {
          archivosEnLotes.push(archivos.slice(i, i + BATCH_SIZE));
      }

      console.log(`🔄 Procesando en ${archivosEnLotes.length} lotes de máximo ${BATCH_SIZE} archivos`);

      // Inicializar monitor de rendimiento
      const performanceMonitor = createPerformanceMonitor();

      for (let loteIndex = 0; loteIndex < archivosEnLotes.length; loteIndex++) {
          const loteArchivos = archivosEnLotes[loteIndex];
          console.log(`\n📦 Procesando lote ${loteIndex + 1}/${archivosEnLotes.length} (${loteArchivos.length} archivos)`);

          // Arrays para operaciones bulk
          const bulkOperations = [];
          const archivosParaMover = [];
          const archivosDuplicados = [];

          // Procesar archivos del lote
          for (const archivo of loteArchivos) {
              const rutaOrigen = path.join(sentenciasDir, archivo);
              
              try {
                  const contenido = fs.readFileSync(rutaOrigen, 'utf8');
                  const jsonData = JSON.parse(contenido);

                  // Verificar duplicados usando el Set en memoria (mucho más rápido)
                  if (existingIds.has(jsonData.id.toString())) {
                      console.log(`⚠️ Duplicado: ${jsonData.id} - ${archivo}`);
                      duplicateCount++;
                      archivosDuplicados.push({ archivo, rutaOrigen });
                      continue;
                  }

                  // Preparar entrada para bulk insert
                  const entrada = createMongoEntry(jsonData, BASE_NAME);
                  
                  bulkOperations.push({
                      insertOne: {
                          document: entrada
                      }
                  });

                  archivosParaMover.push({ archivo, rutaOrigen });
                  
                  // Agregar ID al Set para evitar duplicados en el mismo lote
                  existingIds.add(jsonData.id.toString());

              } catch (error) {
                  console.error(`❌ Error al procesar ${archivo}:`, error.message);
                  errorCount++;
              }
          }

          // OPTIMIZACIÓN 5: Ejecutar bulk insert si hay operaciones
          if (bulkOperations.length > 0) {
              try {
                  console.log(`💾 Ejecutando bulk insert de ${bulkOperations.length} documentos...`);
                  
                  const bulkResult = await collectionDb.bulkWrite(bulkOperations, {
                      ordered: false,  // Continuar aunque algunos fallen
                      writeConcern: optimalConfig.WRITE_CONCERN
                  });

                  console.log(`✅ Bulk insert completado: ${bulkResult.insertedCount} insertados`);
                  processedCount += bulkResult.insertedCount;

                  // Si hay errores en el bulk, contarlos
                  if (bulkResult.writeErrors && bulkResult.writeErrors.length > 0) {
                      errorCount += bulkResult.writeErrors.length;
                      console.log(`⚠️ Errores en bulk insert: ${bulkResult.writeErrors.length}`);
                  }

              } catch (bulkError) {
                  console.error(`❌ Error en bulk insert:`, bulkError.message);
                  errorCount += bulkOperations.length;
              }
          }

          // OPTIMIZACIÓN 6: Mover archivos en paralelo después del bulk insert
          const movePromises = [];
          
          // Mover archivos procesados exitosamente
          for (const { archivo, rutaOrigen } of archivosParaMover) {
              const rutaDestino = path.join(successDir, archivo);
              movePromises.push(
                  fs.promises.rename(rutaOrigen, rutaDestino)
                      .then(() => {
                          movedCount++;
                          return `✅ ${archivo}`;
                      })
                      .catch(error => {
                          console.error(`❌ Error moviendo ${archivo}:`, error.message);
                          return `❌ ${archivo}`;
                      })
              );
          }

          // Mover archivos duplicados también
          for (const { archivo, rutaOrigen } of archivosDuplicados) {
              const rutaDestino = path.join(successDir, archivo);
              movePromises.push(
                  fs.promises.rename(rutaOrigen, rutaDestino)
                      .then(() => {
                          movedCount++;
                          return `📦 ${archivo} (duplicado)`;
                      })
                      .catch(error => {
                          console.error(`❌ Error moviendo duplicado ${archivo}:`, error.message);
                          return `❌ ${archivo}`;
                      })
              );
          }

          // Ejecutar movimientos en paralelo
          if (movePromises.length > 0) {
              console.log(`📁 Moviendo ${movePromises.length} archivos a success...`);
              await Promise.allSettled(movePromises);
          }

          // Progreso del lote con métricas de rendimiento
          console.log(`📊 Lote ${loteIndex + 1} completado:`);
          console.log(`   ✅ Procesados: ${bulkOperations.length}`);
          console.log(`   ⚠️ Duplicados: ${archivosDuplicados.length}`);
          console.log(`   📁 Movidos: ${movePromises.length}`);
          
          // Mostrar métricas de rendimiento
          performanceMonitor.logBatchPerformance(
              bulkOperations.length, 
              loteIndex + 1, 
              archivosEnLotes.length
          );

          // OPTIMIZACIÓN 7: Pausa dinámica entre lotes
          if (loteIndex < archivosEnLotes.length - 1) {
              await new Promise(resolve => setTimeout(resolve, optimalConfig.BATCH_PAUSE_MS));
          }
      }

      // Resumen final con estadísticas de rendimiento
      const finalStats = performanceMonitor.getFinalStats(processedCount, errorCount, duplicateCount);
      
      console.log(`\n🎉 Indexación en MongoDB completada:`);
      console.log(`   ✅ Procesadas exitosamente: ${processedCount}`);
      console.log(`   ⚠️ Duplicadas omitidas: ${duplicateCount}`);
      console.log(`   ❌ Errores: ${errorCount}`);
      console.log(`   📦 Archivos movidos a success: ${movedCount}`);
      console.log(`   📊 Total archivos: ${archivos.length}`);
      console.log(`\n⚡ Estadísticas de rendimiento:`);
      console.log(`   ⏱️ Tiempo total: ${finalStats.totalTime}s`);
      console.log(`   📈 Velocidad promedio: ${finalStats.overallRate} docs/seg`);
      console.log(`   💾 Throughput total: ${(processedCount / finalStats.totalTime * 60).toFixed(0)} docs/min`);
      
      // Verificar archivos restantes
      const archivosRestantes = fs.readdirSync(sentenciasDir).filter(archivo => 
          archivo.endsWith('.json') && fs.statSync(path.join(sentenciasDir, archivo)).isFile()
      );
      
      if (archivosRestantes.length > 0) {
          console.log(`⚠️ Archivos restantes en carpeta origen (con errores): ${archivosRestantes.length}`);
          console.log(`   📁 Ubicación: ${sentenciasDir}`);
      } else {
          console.log(`🧹 Carpeta origen limpia - todos los archivos fueron procesados`);
      }

      // OPTIMIZACIÓN 8: Cerrar conexión optimizada
      await optimizedClient.close();
      console.log('🔌 Conexión MongoDB cerrada');

  } catch (e) {
      console.error('❌ Error general al indexar sentencias en MongoDB:', e.message);
  }
}

indexarMongo('buscadorDB', 'jurisprudencia');

/* 
157.230.7.238
134.122.29.55
137.184.199.205
142.93.205.195
159.89.86.238
143.244.152.224
157.230.236.157
*/