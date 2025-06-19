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
          if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.message.includes('timeout')) {
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
          } else {
            // Para otros tipos de error críticos, también detener el servicio
            console.error(`❌ Error crítico no relacionado con timeout. DETENIENDO SERVICIO.`);
            saveProgress(page, processedCount, 'FAILED_CRITICAL_ERROR');
            console.log(`🛑 SERVICIO DETENIDO por error crítico:`);
            console.log(`   ✅ Total procesados: ${processedCount}`);
            console.log(`   ⏳ Tiempo de ejecución: ${new Date() - start}ms`);
            console.log(`   📄 Última página procesada: ${Math.floor(page / elementPerPage)}`);
            console.log(`   🔄 Para reanudar, ejecute el servicio nuevamente.`);
            
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
async function indexarSentenciasFromData(sentenciasData, dbName, collection, tipoBase = 'civil', options = { indexPinecone: true, indexMongo: true }) {
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

    case 'salud_ca':
      return {
        ...baseMetadata,
        base: 'salud corte de apelaciones',
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

    case 'salud_cs':
      return {
        ...baseMetadata,
        base: 'salud corte suprema',
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
    idSentence: parseInt(jsonData.id) || jsonData.id,
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

    case 'salud_ca':
      return {
        ...baseEntry,
        base: 'salud corte de apelaciones',
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

    case 'salud_cs':
      return {
        ...baseEntry,
        base: 'salud corte suprema',
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

getData(ID_BUSCADOR, BASE_BJUD_URL)
