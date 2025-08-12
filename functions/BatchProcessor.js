/**
 * Sistema de procesamiento en lotes con monitoreo de rendimiento
 * Procesa documentos en paralelo para optimizar tiempos de indexación
 */

class BatchProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 20; // Documentos por lote
    this.maxConcurrency = options.maxConcurrency || 5; // Lotes paralelos máximos
    this.delayBetweenBatches = options.delayBetweenBatches || 1000; // ms entre lotes
    this.delayBetweenItems = options.delayBetweenItems || 200; // ms entre items del mismo lote
    
    // Métricas de rendimiento
    this.stats = {
      startTime: null,
      endTime: null,
      totalDocuments: 0,
      processedDocuments: 0,
      errorDocuments: 0,
      skippedDocuments: 0,
      currentBatch: 0,
      totalBatches: 0,
      documentsPerMinute: 0,
      estimatedTimeRemaining: 0
    };

    // Para mostrar progreso
    this.progressInterval = null;
  }

  /**
   * Divide los documentos en lotes del tamaño especificado
   */
  createBatches(documents) {
    const batches = [];
    for (let i = 0; i < documents.length; i += this.batchSize) {
      batches.push(documents.slice(i, i + this.batchSize));
    }
    return batches;
  }

  /**
   * Procesa un lote de documentos en paralelo
   */
  async processBatch(batch, batchIndex, processFunction) {
    console.log(`\n📦 === LOTE ${batchIndex + 1} - Procesando ${batch.length} documentos ===`);
    
    const batchStartTime = Date.now();
    const promises = batch.map(async (item, itemIndex) => {
      try {
        // Pequeña pausa escalonada para evitar saturar el servicio
        await new Promise(resolve => setTimeout(resolve, itemIndex * this.delayBetweenItems));
        
        const result = await processFunction(item, batchIndex, itemIndex);
        
        if (result.success) {
          this.stats.processedDocuments++;
          console.log(`   ✅ [${batchIndex + 1}.${itemIndex + 1}] ${item.filename || item.id} - OK`);
        } else {
          this.stats.errorDocuments++;
          console.log(`   ❌ [${batchIndex + 1}.${itemIndex + 1}] ${item.filename || item.id} - ERROR`);
        }
        
        return result;
      } catch (error) {
        this.stats.errorDocuments++;
        console.error(`   💥 [${batchIndex + 1}.${itemIndex + 1}] ${item.filename || item.id} - EXCEPCIÓN:`, error.message);
        return { success: false, error: error.message, item };
      }
    });

    const results = await Promise.all(promises);
    const batchTime = Date.now() - batchStartTime;
    
    console.log(`📦 Lote ${batchIndex + 1} completado en ${(batchTime / 1000).toFixed(1)}s`);
    
    return results;
  }

  /**
   * Actualiza y muestra las métricas de rendimiento
   */
  updateStats() {
    const now = Date.now();
    const elapsedTime = (now - this.stats.startTime) / 1000; // segundos
    const elapsedMinutes = elapsedTime / 60;
    
    if (elapsedMinutes > 0) {
      this.stats.documentsPerMinute = Math.round(this.stats.processedDocuments / elapsedMinutes);
    }
    
    // Estimación de tiempo restante
    const remainingDocs = this.stats.totalDocuments - (this.stats.processedDocuments + this.stats.errorDocuments + this.stats.skippedDocuments);
    if (this.stats.documentsPerMinute > 0) {
      this.stats.estimatedTimeRemaining = Math.round(remainingDocs / this.stats.documentsPerMinute);
    }
  }

  /**
   * Muestra el progreso actual
   */
  showProgress() {
    this.updateStats();
    const progress = ((this.stats.processedDocuments + this.stats.errorDocuments + this.stats.skippedDocuments) / this.stats.totalDocuments * 100).toFixed(1);
    
    console.log(`\n📊 === PROGRESO ACTUAL ===`);
    console.log(`   🎯 Progreso: ${progress}% (${this.stats.processedDocuments + this.stats.errorDocuments + this.stats.skippedDocuments}/${this.stats.totalDocuments})`);
    console.log(`   ✅ Procesados: ${this.stats.processedDocuments}`);
    console.log(`   ❌ Errores: ${this.stats.errorDocuments}`);
    console.log(`   ⏭️ Omitidos: ${this.stats.skippedDocuments}`);
    console.log(`   📦 Lote actual: ${this.stats.currentBatch}/${this.stats.totalBatches}`);
    console.log(`   🚀 Velocidad: ${this.stats.documentsPerMinute} docs/min`);
    console.log(`   ⏱️ Tiempo estimado restante: ${this.stats.estimatedTimeRemaining} minutos`);
    console.log(`   ⏰ Tiempo transcurrido: ${((Date.now() - this.stats.startTime) / 60000).toFixed(1)} min`);
  }

  /**
   * Inicia el monitoreo de progreso cada 30 segundos
   */
  startProgressMonitoring() {
    this.progressInterval = setInterval(() => {
      this.showProgress();
    }, 30000); // Cada 30 segundos
  }

  /**
   * Detiene el monitoreo de progreso
   */
  stopProgressMonitoring() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Procesa todos los documentos en lotes con paralelización controlada
   */
  async processAll(documents, processFunction) {
    console.log(`🚀 === INICIANDO PROCESAMIENTO EN LOTES ===`);
    console.log(`   📊 Total documentos: ${documents.length}`);
    console.log(`   📦 Tamaño de lote: ${this.batchSize}`);
    console.log(`   🔄 Concurrencia máxima: ${this.maxConcurrency}`);
    console.log(`   ⏱️ Pausa entre lotes: ${this.delayBetweenBatches}ms`);
    console.log(`   ⏱️ Pausa entre items: ${this.delayBetweenItems}ms`);

    // Inicializar estadísticas
    this.stats.startTime = Date.now();
    this.stats.totalDocuments = documents.length;
    this.stats.processedDocuments = 0;
    this.stats.errorDocuments = 0;
    this.stats.skippedDocuments = 0;

    // Crear lotes
    const batches = this.createBatches(documents);
    this.stats.totalBatches = batches.length;
    
    console.log(`📦 Creados ${batches.length} lotes`);

    // Iniciar monitoreo
    this.startProgressMonitoring();

    const allResults = [];

    try {
      // Procesar lotes con concurrencia controlada
      for (let i = 0; i < batches.length; i += this.maxConcurrency) {
        const batchGroup = batches.slice(i, i + this.maxConcurrency);
        
        console.log(`\n🔄 === PROCESANDO GRUPO DE LOTES ${Math.floor(i / this.maxConcurrency) + 1} ===`);
        console.log(`   📦 Lotes en paralelo: ${batchGroup.length} (${i + 1}-${Math.min(i + batchGroup.length, batches.length)})`);

        // Procesar lotes en paralelo dentro del grupo
        const batchPromises = batchGroup.map((batch, groupIndex) => {
          const actualBatchIndex = i + groupIndex;
          this.stats.currentBatch = actualBatchIndex + 1;
          return this.processBatch(batch, actualBatchIndex, processFunction);
        });

        const groupResults = await Promise.all(batchPromises);
        allResults.push(...groupResults.flat());

        // Pausa entre grupos de lotes
        if (i + this.maxConcurrency < batches.length) {
          console.log(`⏸️ Pausa de ${this.delayBetweenBatches}ms entre grupos...`);
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
        }
      }

    } finally {
      // Detener monitoreo
      this.stopProgressMonitoring();
    }

    // Estadísticas finales
    this.stats.endTime = Date.now();
    this.showFinalStats();

    return {
      success: true,
      results: allResults,
      stats: this.stats
    };
  }

  /**
   * Muestra estadísticas finales
   */
  showFinalStats() {
    const totalTime = (this.stats.endTime - this.stats.startTime) / 1000;
    const totalMinutes = totalTime / 60;
    const finalDocsPerMinute = Math.round(this.stats.processedDocuments / totalMinutes);

    console.log(`\n🎉 === PROCESAMIENTO COMPLETADO ===`);
    console.log(`   ⏰ Tiempo total: ${(totalMinutes).toFixed(1)} minutos`);
    console.log(`   📊 Total documentos: ${this.stats.totalDocuments}`);
    console.log(`   ✅ Procesados exitosamente: ${this.stats.processedDocuments}`);
    console.log(`   ❌ Errores: ${this.stats.errorDocuments}`);
    console.log(`   ⏭️ Omitidos: ${this.stats.skippedDocuments}`);
    console.log(`   🚀 Velocidad promedio: ${finalDocsPerMinute} docs/min`);
    console.log(`   📈 Tasa de éxito: ${((this.stats.processedDocuments / this.stats.totalDocuments) * 100).toFixed(1)}%`);
    
    if (this.stats.errorDocuments > 0) {
      console.log(`   ⚠️ Tasa de error: ${((this.stats.errorDocuments / this.stats.totalDocuments) * 100).toFixed(1)}%`);
    }
  }

  /**
   * Método estático para crear y usar el procesador fácilmente
   */
  static async process(documents, processFunction, options = {}) {
    const processor = new BatchProcessor(options);
    return await processor.processAll(documents, processFunction);
  }
}

module.exports = BatchProcessor;