const redis = require('redis');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class CacheManager {
    constructor(options = {}) {
        this.useRedis = options.useRedis !== false; // Por defecto usar Redis
        this.redisClient = null;
        this.cacheFile = options.cacheFile || 'cache/existing_ids.json.gz';
        this.memoryCache = new Set(); // Fallback en memoria
        this.isInitialized = false;
        this.redisConfig = {
            host: options.redisHost || 'localhost',
            port: options.redisPort || 6379,
            password: options.redisPassword || undefined,
            db: options.redisDb || 3
        };
    }

    /**
     * Inicializar el sistema de caché
     */
    async initialize() {
        if (this.isInitialized) return;

        console.log('🔄 Inicializando sistema de caché...');

        if (this.useRedis) {
            try {
                await this.initializeRedis();
                console.log('✅ Redis inicializado correctamente');
                this.isInitialized = true;
                return;
            } catch (error) {
                console.log('⚠️ Redis no disponible, usando archivo como fallback:', error.message);
                this.useRedis = false;
            }
        }

        // Fallback: usar archivo comprimido
        await this.initializeFileCache();
        console.log('✅ Caché de archivo inicializado');
        this.isInitialized = true;
    }

    /**
     * Inicializar Redis
     */
    async initializeRedis() {
        this.redisClient = redis.createClient(this.redisConfig);
        
        this.redisClient.on('error', (err) => {
            console.error('❌ Error de Redis:', err);
        });

        this.redisClient.on('connect', () => {
            console.log('🔗 Conectado a Redis');
        });

        await this.redisClient.connect();
        
        // Verificar si ya tenemos datos
        const existingCount = await this.redisClient.sCard('existing_ids');
        console.log(`📊 IDs en Redis: ${existingCount}`);
    }

    /**
     * Inicializar caché de archivo
     */
    async initializeFileCache() {
        try {
            // Crear directorio si no existe
            const cacheDir = path.dirname(this.cacheFile);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            // Cargar archivo existente
            if (fs.existsSync(this.cacheFile)) {
                console.log('📁 Cargando caché desde archivo...');
                const compressed = fs.readFileSync(this.cacheFile);
                const decompressed = zlib.gunzipSync(compressed);
                const ids = JSON.parse(decompressed.toString());
                
                this.memoryCache = new Set(ids);
                console.log(`✅ ${this.memoryCache.size} IDs cargados desde archivo`);
            } else {
                console.log('📝 Archivo de caché no existe, se creará uno nuevo');
                this.memoryCache = new Set();
            }
        } catch (error) {
            console.error('❌ Error inicializando caché de archivo:', error);
            this.memoryCache = new Set();
        }
    }

    /**
     * Verificar si un ID existe
     */
    async exists(id) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const idStr = id.toString();

        if (this.useRedis && this.redisClient) {
            try {
                return await this.redisClient.sIsMember('existing_ids', idStr);
            } catch (error) {
                console.error('❌ Error verificando en Redis:', error);
                // Fallback a memoria
                return this.memoryCache.has(idStr);
            }
        }

        return this.memoryCache.has(idStr);
    }

    /**
     * Agregar un ID al caché
     */
    async add(id) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const idStr = id.toString();

        if (this.useRedis && this.redisClient) {
            try {
                await this.redisClient.sAdd('existing_ids', idStr);
            } catch (error) {
                console.error('❌ Error agregando a Redis:', error);
            }
        }

        // Siempre agregar a memoria como backup
        this.memoryCache.add(idStr);
    }

    /**
     * Agregar múltiples IDs en lote
     */
    async addBatch(ids) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const idsStr = ids.map(id => id.toString());

        if (this.useRedis && this.redisClient) {
            try {
                // Redis puede manejar lotes grandes eficientemente
                const batchSize = 10000;
                for (let i = 0; i < idsStr.length; i += batchSize) {
                    const batch = idsStr.slice(i, i + batchSize);
                    await this.redisClient.sAdd('existing_ids', batch);
                }
                console.log(`✅ ${idsStr.length} IDs agregados a Redis`);
            } catch (error) {
                console.error('❌ Error agregando lote a Redis:', error);
            }
        }

        // Agregar a memoria
        idsStr.forEach(id => this.memoryCache.add(id));
    }

    /**
     * Obtener el tamaño del caché
     */
    async size() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (this.useRedis && this.redisClient) {
            try {
                return await this.redisClient.sCard('existing_ids');
            } catch (error) {
                console.error('❌ Error obteniendo tamaño de Redis:', error);
                return this.memoryCache.size;
            }
        }

        return this.memoryCache.size;
    }

    /**
     * Sincronizar caché con Qdrant
     */
    async syncWithQdrant(qdrantUrl, collectionName) {
        console.log('🔄 Sincronizando caché con Qdrant...');
        
        const currentSize = await this.size();
        console.log(`📊 IDs actuales en caché: ${currentSize}`);

        try {
            const axios = require('axios');
            
            // Obtener estadísticas de Qdrant
            const response = await axios.get(`${qdrantUrl}/collections/${collectionName}`);
            const totalVectors = response.data.result?.vectors_count || 0;

            console.log(`📊 Total de vectores en Qdrant: ${totalVectors}`);

            if (totalVectors === 0) {
                console.log('ℹ️ No hay vectores en Qdrant');
                return;
            }

            // Si el caché está vacío o desactualizado, sincronizar
            if (currentSize === 0 || Math.abs(currentSize - totalVectors) > 1000) {
                console.log('🔄 Sincronización necesaria...');
                await this.fullSyncFromQdrant(qdrantUrl, collectionName, totalVectors);
            } else {
                console.log('✅ Caché ya está sincronizado');
            }

        } catch (error) {
            console.error('❌ Error sincronizando con Qdrant:', error);
        }
    }

    /**
     * Sincronización completa desde Qdrant
     */
    async fullSyncFromQdrant(qdrantUrl, collectionName, totalVectors) {
        console.log('🔄 Iniciando sincronización completa desde Qdrant...');
        
        const axios = require('axios');
        const ids = [];
        let processedVectors = 0;
        const batchSize = 10000;
        let offset = null;

        while (processedVectors < totalVectors) {
            try {
                const scrollRequest = {
                    limit: Math.min(batchSize, totalVectors - processedVectors),
                    with_payload: true,
                    with_vector: false
                };
                
                if (offset) {
                    scrollRequest.offset = offset;
                }

                const response = await axios.post(
                    `${qdrantUrl}/collections/${collectionName}/points/scroll`,
                    scrollRequest,
                    { headers: { 'Content-Type': 'application/json' } }
                );

                const result = response.data.result;
                if (result.points && result.points.length > 0) {
                    result.points.forEach(point => {
                        if (point.payload && point.payload.idSentence) {
                            ids.push(point.payload.idSentence.toString());
                        }
                    });
                    processedVectors += result.points.length;
                    offset = result.next_page_offset;
                } else {
                    break;
                }

                console.log(`📊 Sincronizados ${processedVectors}/${totalVectors} vectores...`);

                // Pausa para no saturar la API
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Si no hay más páginas, salir
                if (!offset) break;
                
            } catch (batchError) {
                console.log(`⚠️ Error en lote de sincronización: ${batchError.message}`);
                break;
            }
        }

        // Agregar todos los IDs al caché
        if (ids.length > 0) {
            await this.addBatch(ids);
            console.log(`✅ ${ids.length} IDs sincronizados desde Qdrant`);
        }

        // Guardar en archivo como backup
        await this.saveToFile();
    }

    /**
     * Guardar caché en archivo comprimido
     */
    async saveToFile() {
        if (!this.useRedis) {
            // Solo guardar si no estamos usando Redis
            try {
                const ids = Array.from(this.memoryCache);
                const json = JSON.stringify(ids);
                const compressed = zlib.gzipSync(json);
                
                const cacheDir = path.dirname(this.cacheFile);
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                }
                
                fs.writeFileSync(this.cacheFile, compressed);
                console.log(`💾 Caché guardado en archivo: ${ids.length} IDs`);
            } catch (error) {
                console.error('❌ Error guardando caché:', error);
            }
        }
    }

    /**
     * Cerrar conexiones
     */
    async close() {
        if (this.redisClient) {
            await this.redisClient.quit();
        }
        
        if (!this.useRedis) {
            await this.saveToFile();
        }
    }
}

module.exports = CacheManager; 