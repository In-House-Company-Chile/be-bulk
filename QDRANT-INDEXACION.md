# Indexación en Qdrant - Documentación

## 📋 Resumen

Se ha implementado un sistema completo para indexar documentos jurídicos en Qdrant usando un servicio de embeddings externo. La solución incluye:

- ✅ Clase `IndexarQdrant` para indexar documentos con embeddings de 1024 dimensiones
- ✅ Clase `LoadDocumentsFromDir` para cargar documentos desde carpetas externas
- ✅ Integración con el sistema existente de indexación
- ✅ Script de ejemplo listo para usar

## 🔧 Configuración

### Variables de Entorno

Agrega estas variables a tu archivo `.env`:

```bash
# URLs de servicios Qdrant
QDRANT_URL=http://ms-qdrant-8f82e7cd-8cc2.governare.ai
EMBEDDING_URL=http://ms-vector.governare.ai/embed
```

### Instalación de Dependencias

Las dependencias necesarias ya están incluidas en el proyecto:
- `axios` - Para llamadas HTTP
- `@langchain/textsplitters` - Para dividir texto en chunks

## 🚀 Uso Rápido

### Opción 1: Verificar Conexión (Recomendado primero)

1. **Probar la conexión a los servicios:**
   ```bash
   node test-qdrant-connection.js
   ```

### Opción 2: Script Optimizado con Procesamiento en Lotes (RECOMENDADO)

1. **Usar el script optimizado con configuraciones predefinidas:**
   ```bash
   # Para servicios locales (Qdrant + GPU local) - RECOMENDADO para tu setup
   node indexar-qdrant-optimizado.js local
   
   # Para GPU potente local (RTX 3060+) - MÁXIMO RENDIMIENTO
   node indexar-qdrant-optimizado.js ultra
   
   # Configuración balanceada (servicios remotos)
   node indexar-qdrant-optimizado.js balanceada
   
   # Para sistemas muy potentes con servicios remotos
   node indexar-qdrant-optimizado.js maxima
   ```

2. **Ver ayuda completa:**
   ```bash
   node indexar-qdrant-optimizado.js --help
   ```

### Opción 3: Script de Ejemplo Básico

1. **El archivo `indexar-qdrant-ejemplo.js` ya está configurado:**
   ```javascript
   const CARPETA_DOCUMENTOS = 'C:/Users/kathe/Desktop/Leo/sentencias/test';
   const TIPO_BASE = 'corte_de_apelaciones';
   ```

2. **Ejecuta el script:**
   ```bash
   node indexar-qdrant-ejemplo.js
   ```

### Opción 3: Integración con Función Existente

Puedes usar la función existente `indexarSentenciasFromData` con Qdrant como indexador principal:

```javascript
// En puca copy.js - Qdrant es ahora el indexador principal por defecto
await indexarSentenciasFromData(
  sentenciasArray, 
  'buscadorDB', 
  'jurisprudencia', 
  'corte_de_apelaciones', // ✅ Tipo específico para metadatos apropiados
  { 
    indexPinecone: false,  // ❌ Desactivado por defecto
    indexMongo: true,      // ✅ Opcional para backup  
    indexQdrant: true,     // ✅ Activado por defecto como principal
    qdrantCollection: 'test_jurisprudencia' 
  }
);
```

### Opción 3: Uso Directo de las Clases

```javascript
const IndexarQdrant = require('./functions/IndexarQdrant');
const LoadDocumentsFromDir = require('./functions/LoadDocumentsFromDir');

// Cargar documentos desde carpeta
const documents = await LoadDocumentsFromDir.create('/ruta/carpeta', {
  extensions: ['.json', '.txt', '.md'],
  recursive: true
});

// Indexar cada documento
for (const doc of documents) {
  await IndexarQdrant.create(doc.text, 'test_jurisprudencia', doc.metadata);
}
```

## 📂 Formatos de Archivos Soportados

### Archivos JSON
El sistema puede procesar archivos JSON con diferentes estructuras:

**Sentencias judiciales:**
```json
{
  "id": "123456",
  "texto_sentencia": "Contenido de la sentencia...",
  "rol_era_sup_s": "ROL-123-2024",
  "caratulado_s": "Caso ejemplo",
  "fec_sentencia_sup_dt": "2024-01-15",
  "gls_juz_s": "Tribunal de ejemplo"
}
```

**Normas legales:**
```json
{
  "idNorm": "LEY-123",
  "planeText": "Contenido de la norma...",
  "data": {
    "metadatos": {
      "titulo_norma": "Ley ejemplo",
      "fecha_publicacion": "2024-01-01"
    }
  }
}
```

### Archivos de Texto
- `.txt` - Archivos de texto plano
- `.md` - Archivos Markdown

## ⚙️ Configuraciones Avanzadas

### Opciones de Carga de Documentos

```javascript
const options = {
  extensions: ['.json', '.txt', '.md'],  // Extensiones a procesar
  recursive: true,                       // Buscar en subcarpetas
  processedDir: '/ruta/procesados',      // Mover archivos procesados (opcional)
  encoding: 'utf8'                       // Codificación de archivos
};
```

### Configuración de Chunks (Optimizada)

Los documentos se dividen automáticamente en chunks optimizados para documentos jurídicos:
- **Tamaño:** 1000 caracteres (aumentado para más contexto jurídico)
- **Overlap:** 100 caracteres (10% para mantener continuidad)
- **Separadores:** Jerárquicos (párrafos → oraciones → frases → palabras)
- **Dimensiones de embedding:** 1024

### Metadatos por Tipo de Base

El sistema genera metadatos específicos según el tipo de base:

- `civil` - Rol, caratulado, fecha sentencia, tribunal, juez, materia
- `penal` - Incluye resultado y arrays de materias/jueces
- `familia` - Similar a civil con códigos de materia
- `corte_suprema` - Sala, era, categorización, descriptores, normas
- `general` - Metadatos básicos extraídos automáticamente

## 🔍 Búsqueda en Qdrant

La clase `IndexarQdrant` también incluye funcionalidad de búsqueda:

```javascript
const indexer = new IndexarQdrant('', 'test_jurisprudencia');
const results = await indexer.search('pensión alimenticia menores', 10, 0.7);
console.log(results.results);
```

## 📊 Monitoreo y Logs

El sistema proporciona logs detallados durante la indexación:

```
🚀 Iniciando indexación de documentos desde carpeta externa...
📂 Carpeta: /ruta/documentos
📦 Colección Qdrant: test_jurisprudencia
📄 Encontrados 15 documentos para indexar
🔄 Procesando documento 1/15: sentencia_001.json
📄 Documento dividido en 5 chunks
🔄 Generando embedding para chunk 1/5...
✅ Documento sentencia_001.json indexado exitosamente (5/5 chunks)
```

## ❗ Solución de Problemas

### Error de Conexión a Qdrant
```
❌ Error verificando colección: connect ECONNREFUSED
```
**Solución:** Verifica que la URL de Qdrant sea correcta y que el servicio esté disponible.

### Error de Dimensiones de Embedding
```
❌ Embedding tiene dimensión incorrecta: 768, se esperaba 1024
```
**Solución:** Verifica que el servicio de embeddings esté configurado para generar vectores de 1024 dimensiones.

### Carpeta No Encontrada
```
❌ La carpeta no existe: /ruta/documentos
```
**Solución:** Verifica que la ruta de la carpeta sea correcta y que tenga permisos de lectura.

## 🔄 Flujo de Procesamiento

1. **Carga de Documentos:** Lee archivos desde la carpeta especificada
2. **Validación:** Verifica que los documentos tengan contenido de texto
3. **División en Chunks:** Divide documentos grandes en fragmentos de 800 caracteres
4. **Generación de Embeddings:** Usa el servicio externo para generar vectores de 1024 dimensiones
5. **Indexación en Qdrant:** Almacena vectores con metadatos en la colección especificada
6. **Logging:** Proporciona retroalimentación detallada del progreso

## 📈 Rendimiento y Monitoreo

### Sistema de Procesamiento en Lotes

El nuevo sistema procesa documentos en **lotes paralelos** para optimizar velocidad:

- **Lotes de 20 documentos** procesados en paralelo
- **Hasta 3 lotes simultáneos** (configurable)
- **Monitoreo en tiempo real** cada 30 segundos
- **Métricas de rendimiento:** docs/min, tiempo estimado, progreso

### Configuraciones de Rendimiento

| Configuración | Lote | Paralelos | Pausas | Velocidad Est. | Uso Recomendado |
|---------------|------|-----------|--------|----------------|-----------------|
| **Conservadora** | 10 docs | 2 lotes | 800ms | ~15 docs/min | Sistemas lentos |
| **Balanceada** | 20 docs | 3 lotes | 300ms | ~30 docs/min | Servicios remotos |
| **Agresiva** | 30 docs | 5 lotes | 100ms | ~50 docs/min | Sistemas potentes |
| **Máxima** | 50 docs | 8 lotes | 50ms | ~80 docs/min | Remotos muy potentes |
| **Local** | 30 docs | 10 lotes | 0ms | ~120 docs/min | **Servicios locales** |
| **Ultra** | 40 docs | 15 lotes | 0ms | ~200 docs/min | **RTX 3060+ local** |

### Monitoreo en Tiempo Real

```
📊 === PROGRESO ACTUAL ===
   🎯 Progreso: 45.2% (226/500)
   ✅ Procesados: 220
   ❌ Errores: 6
   📦 Lote actual: 12/25
   🚀 Velocidad: 32 docs/min
   ⏱️ Tiempo estimado restante: 8 minutos
   ⏰ Tiempo transcurrido: 7.1 min
```

### Timeouts y Pausas

- **Embeddings:** 30s timeout
- **Qdrant:** 60s timeout  
- **Entre lotes:** 2s pausa
- **Entre documentos:** 300ms pausa
- **Manejo robusto de errores:** Continúa con otros documentos

## 🛠️ Mantenimiento

### Verificar Estado de la Colección
```bash
curl -X GET "http://ms-qdrant-8f82e7cd-8cc2.governare.ai/collections/test_jurisprudencia"
```

### Limpiar Colección (si es necesario)
```bash
curl -X DELETE "http://ms-qdrant-8f82e7cd-8cc2.governare.ai/collections/test_jurisprudencia"
```

## 📞 Soporte

Si tienes preguntas sobre la implementación:

1. Revisa los logs detallados que proporciona el sistema
2. Verifica la conectividad a los servicios de Qdrant y embeddings
3. Asegúrate de que los documentos tengan el formato correcto
4. Consulta esta documentación para configuraciones específicas