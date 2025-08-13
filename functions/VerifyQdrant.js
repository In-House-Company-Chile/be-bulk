// Función para obtener IDs existentes de Qdrant
async function getExistingQdrantIds(collectionName, qdrantUrl = 'http://localhost:6333') {
    const existingIds = new Set();

    try {
        // Obtener información de la colección
        const collectionInfo = await axios.get(`${qdrantUrl}/collections/${collectionName}`);

        if (collectionInfo.data.status === 'ok') {
            const vectorCount = collectionInfo.data.result.vectors_count;
            console.log(`📊 Total de vectores en Qdrant: ${vectorCount}`);

            if (vectorCount > 0) {
                // Qdrant permite scroll para obtener todos los puntos
                let offset = null;
                let hasMore = true;
                const limit = 1000; // Procesar en lotes de 1000

                while (hasMore) {
                    const scrollRequest = {
                        limit: limit,
                        with_payload: ["idSentence"], // Solo necesitamos el ID
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

                    if (response.data.result && response.data.result.points) {
                        response.data.result.points.forEach(point => {
                            if (point.payload && point.payload.idSentence) {
                                existingIds.add(point.payload.idSentence.toString());
                            }
                        });

                        // Verificar si hay más datos
                        if (response.data.result.points.length < limit) {
                            hasMore = false;
                        } else {
                            offset = response.data.result.next_page_offset;
                        }

                        console.log(`📋 Procesados ${existingIds.size} IDs únicos...`);
                    } else {
                        hasMore = false;
                    }
                }
            }

            console.log(`✅ ${existingIds.size} IDs únicos encontrados en Qdrant`);
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log('📦 La colección no existe aún, se creará al indexar');
        } else {
            console.log('⚠️ Error obteniendo IDs de Qdrant:', error.message);
        }
    }

    return existingIds;
}

module.exports = getExistingQdrantIds;