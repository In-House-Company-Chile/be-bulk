require('dotenv').config();
const IndexarQdrant = require('./functions/IndexarQdrant');

// Ejemplo de uso del IndexarQdrant
async function ejemploUso() {
    // Documento de ejemplo con la misma estructura que usas en MongoDB
    const documentoEjemplo = {
        idNorm: "NORM-2024-001",
        planeText: "Este es el texto completo de la norma que será vectorizado...",
        data: {
            metadatos: {
                titulo_norma: "Norma de Ejemplo 2024",
                organismos: ["Ministerio de Ejemplo", "Secretaría de Pruebas"],
                fecha_publicacion: "2024-01-15",
                fecha_promulgacion: "2024-01-01",
                tipo_version_s: "Original",
                vigencia: {
                    inicio_vigencia: "2024-01-15",
                    fin_vigencia: "2025-01-15"
                },
                tipos_numeros: [{
                    compuesto: "LEY-001-2024"
                }]
            }
        }
    };

    try {
        console.log('🚀 Iniciando indexación en Qdrant...');
        
        // Indexar documento
        const resultado = await IndexarQdrant.create(documentoEjemplo);
        console.log('Resultado:', resultado);

        // Crear instancia para operaciones adicionales
        const indexador = new IndexarQdrant(documentoEjemplo);
        
        // Obtener estadísticas
        const stats = await indexador.obtenerEstadisticas();
        console.log('📊 Estadísticas de la colección:', stats);

        // Buscar documentos similares
        const similares = await indexador.buscarSimilares(
            "norma ejemplo ministerio", 
            5, 
            0.5
        );
        console.log('🔍 Documentos similares encontrados:', similares.length);
        similares.forEach((doc, index) => {
            console.log(`${index + 1}. ${doc.metadatos.titulo_norma} (Score: ${doc.score.toFixed(3)})`);
        });

    } catch (error) {
        console.error('❌ Error en el ejemplo:', error.message);
    }
}

// Función para migrar todos los documentos de MongoDB a Qdrant
async function migrarDesdeMongoAQdrant() {
    const { MongoClient } = require('mongodb');
    
    const mongoClient = new MongoClient(process.env.MONGO_URL);
    
    try {
        await mongoClient.connect();
        console.log('📦 Conectado a MongoDB para migración...');
        
        const db = mongoClient.db('tu_base_de_datos'); // Cambia por tu nombre de BD
        const collection = db.collection('tu_coleccion'); // Cambia por tu colección
        
        const documentos = await collection.find({}).toArray();
        console.log(`📋 Encontrados ${documentos.length} documentos para migrar`);
        
        let procesados = 0;
        let errores = 0;
        
        for (const doc of documentos) {
            try {
                // Transformar el documento al formato esperado si es necesario
                const documentoParaQdrant = {
                    idNorm: doc.idNorm,
                    planeText: doc.planeText,
                    data: doc.data
                };
                
                await IndexarQdrant.create(documentoParaQdrant);
                procesados++;
                
                if (procesados % 10 === 0) {
                    console.log(`✅ Procesados: ${procesados}/${documentos.length}`);
                }
                
            } catch (error) {
                console.error(`❌ Error procesando ${doc.idNorm}:`, error.message);
                errores++;
            }
        }
        
        console.log(`🎉 Migración completada: ${procesados} exitosos, ${errores} errores`);
        
    } catch (error) {
        console.error('❌ Error en la migración:', error.message);
    } finally {
        await mongoClient.close();
    }
}

// Ejecutar ejemplo si se ejecuta directamente
if (require.main === module) {
    ejemploUso()
        .then(() => console.log('✅ Ejemplo completado'))
        .catch(console.error);
}

module.exports = {
    ejemploUso,
    migrarDesdeMongoAQdrant
};
