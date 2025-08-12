const IndexarPinecone2 = require('./functions/IndexarPinecone2');
const IndexarQdrant = require('./functions/IndexarQdrant');
const LoadDocumentsFromDir = require('./functions/LoadDocumentsFromDir');
const BatchProcessor = require('./functions/BatchProcessor');

require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URL;
const client = new MongoClient(uri);

/**
 * Función mejorada para indexar sentencias desde objetos de datos directamente
 * @param {Array} sentenciasData - Array de objetos con los datos de las sentencias
 * @param {string} dbName - Nombre de la base de datos
 * @param {string} collection - Nombre de la colección
 * @param {string} tipoBase - Tipo de base (ej: 'civil', 'penal', 'familia', etc.)
 * @param {Object} options - Opciones adicionales { indexPinecone: boolean, indexMongo: boolean }
 */
async function indexarSentenciasFromData(sentenciasData, dbName, collection, tipoBase, options = { indexPinecone: false, indexMongo: true, indexQdrant: true, qdrantCollection: 'test_jurisprudencia' }) {
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
    console.log(`   🎯 Indexar en Qdrant: ${options.indexQdrant ? '✅' : '❌'}`);
    if (options.indexQdrant) {
      console.log(`   📦 Colección Qdrant: ${options.qdrantCollection}`);
    }

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

        // Indexar en Qdrant si está habilitado (PRINCIPAL)
        if (options.indexQdrant && jsonData.texto_sentencia) {
          try {
            await IndexarQdrant.create(jsonData.texto_sentencia, options.qdrantCollection, metadata);
            console.log(`✅ Sentencia ${jsonData.id} indexada en Qdrant`);
          } catch (qdrantError) {
            console.error(`❌ Error indexando en Qdrant (ID: ${jsonData.id}):`, qdrantError.message);
            errorCount++;
          }
        }

        // Indexar en Pinecone si está habilitado (OPCIONAL/LEGACY)
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
        rol: jsonData.rol_era_ape_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tipoRecurso: jsonData.tip_recurso_s || '',
        juez: jsonData.gls_juz_s || '',
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

/**
 * Función para indexar documentos desde una carpeta externa en Qdrant
 * @param {string} dirPath - Ruta de la carpeta con documentos
 * @param {string} qdrantCollection - Nombre de la colección en Qdrant
 * @param {string} tipoBase - Tipo de base para metadatos
 * @param {Object} options - Opciones adicionales
 */
async function indexarDocumentosExternos(dirPath, qdrantCollection = 'test_jurisprudencia', tipoBase = 'general', options = {}) {
  try {
    console.log(`🚀 Iniciando indexación de documentos desde carpeta externa...`);
    console.log(`📂 Carpeta: ${dirPath}`);
    console.log(`📦 Colección Qdrant: ${qdrantCollection}`);
    console.log(`🏷️ Tipo de base: ${tipoBase}`);

    // Configurar opciones de carga
    const loadOptions = {
      extensions: options.extensions || ['.json', '.txt', '.md'],
      recursive: options.recursive || false,
      processedDir: options.processedDir || null,
      ...options
    };

    // Cargar documentos desde la carpeta
    console.log(`📄 Cargando documentos...`);
    const documents = await LoadDocumentsFromDir.create(dirPath, loadOptions);

    if (documents.length === 0) {
      console.log('⚠️ No se encontraron documentos para procesar');
      return { success: true, processed: 0, errors: 0, total: 0 };
    }

    console.log(`📊 Encontrados ${documents.length} documentos para indexar`);

    // Configurar opciones del procesador en lotes
    const batchOptions = {
      batchSize: options.batchSize || 20,        // Documentos por lote
      maxConcurrency: options.maxConcurrency || 3, // Lotes paralelos (reducido para evitar saturar)
      delayBetweenBatches: options.delayBetweenBatches || 2000, // 2 segundos entre grupos
      delayBetweenItems: options.delayBetweenItems || 500       // 500ms entre items del lote
    };

    // Función para procesar un documento individual
    const processDocument = async (doc, batchIndex, itemIndex) => {
      try {
        // Verificar que el documento tenga texto
        if (!doc.text || doc.text.trim().length === 0) {
          console.log(`   ⚠️ [${batchIndex + 1}.${itemIndex + 1}] ${doc.filename} - Sin texto, omitiendo`);
          return { success: false, skipped: true, reason: 'No text content' };
        }

        // Preparar metadata usando la función createMetadataByType existente
        let metadata;
        if (doc.type === 'json' && doc.data) {
          // Si es un archivo JSON con datos estructurados, usar createMetadataByType
          metadata = createMetadataByType(doc.data, tipoBase);
        } else {
          // Para archivos de texto plano, crear metadata básico
          metadata = {
            idSentence: doc.id || doc.filename,
            base: tipoBase,
            filename: doc.filename,
            type: doc.type,
            originalPath: doc.filePath,
            indexedAt: new Date().toISOString(),
            ...doc.metadata
          };
        }

        // Indexar en Qdrant (pasando la ruta del archivo para manejo de errores)
        const result = await IndexarQdrant.create(doc.text, qdrantCollection, metadata, doc.filePath);
        
        if (result.success) {
          return { 
            success: true, 
            chunks_processed: result.chunks_processed,
            total_chunks: result.total_chunks,
            filename: doc.filename
          };
        } else {
          return { success: false, error: 'Indexing failed', filename: doc.filename };
        }

      } catch (error) {
        return { 
          success: false, 
          error: error.message, 
          filename: doc.filename 
        };
      }
    };

    // Procesar documentos en lotes con monitoreo
    console.log(`\n🔄 Iniciando procesamiento en lotes optimizado...`);
    const batchResult = await BatchProcessor.process(documents, processDocument, batchOptions);

    // Calcular estadísticas finales
    const processedCount = batchResult.stats.processedDocuments;
    const errorCount = batchResult.stats.errorDocuments;
    const skippedCount = batchResult.stats.skippedDocuments;

    return {
      success: true,
      processed: processedCount,
      errors: errorCount,
      skipped: skippedCount,
      total: documents.length,
      stats: batchResult.stats,
      documentsPerMinute: batchResult.stats.documentsPerMinute || 0
    };

  } catch (error) {
    console.error('❌ Error general indexando documentos externos:', error.message);
    return { success: false, message: error.message };
  }
}

// getData(ID_BUSCADOR, BASE_BJUD_URL)

// Exportar funciones para uso externo
module.exports = {
  indexarDocumentosExternos,
  indexarSentenciasFromData,
  createMetadataByType,
  createMongoEntry
};

// Ejemplo de uso para indexar documentos externos:
// indexarDocumentosExternos('/ruta/a/carpeta', 'test_jurisprudencia', 'civil', { 
//   extensions: ['.json', '.txt'], 
//   recursive: true,
//   processedDir: '/ruta/a/procesados' 
// });
