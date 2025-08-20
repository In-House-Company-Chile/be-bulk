# 📋 Instrucciones para Procesar 400K Documentos JSON en Qdrant

## 🚀 Configuración Inicial

### 1. Instalar Dependencias
```bash
npm install @langchain/textsplitters
```

### 2. Configurar Variables de Entorno (.env)
Crea o actualiza tu archivo `.env` con:

```env
# MongoDB Configuration
MONGO_URL=mongodb://localhost:27017

# Qdrant Configuration
QDRANT_URL=http://ms-qdrant-8f82e7cd-8cc2.governare.ai
QDRANT_COLLECTION=normas_juridicas

# Embedding Service Configuration  
EMBEDDING_URL=http://ms-vector.governare.ai/embed

# JSON Processing Configuration
JSON_FILE_PATH=c:\Users\ljutr\Desktop\buscadorDB.normas.json
BATCH_SIZE=25
START_FROM=0
MAX_DOCUMENTS=
LOG_INTERVAL=50
PAUSE_MS=3000

# Optional: Qdrant API Key (if using Qdrant Cloud)
# QDRANT_API_KEY=your_api_key_here
```

## 📊 Opciones de Procesamiento

### Parámetros Configurables:

- **`BATCH_SIZE`**: Número de documentos a procesar por lote (recomendado: 25-50)
- **`START_FROM`**: Índice para resumir procesamiento (0 = desde el inicio)
- **`MAX_DOCUMENTS`**: Límite máximo de documentos (vacío = todos los ~400k)
- **`LOG_INTERVAL`**: Cada cuántos documentos mostrar progreso (recomendado: 50-100)
- **`PAUSE_MS`**: Pausa en milisegundos entre lotes (recomendado: 2000-5000)

## 🎯 Comandos de Ejecución

### 1. Procesamiento de Prueba (Recomendado Primero)
```bash
node procesar-json-masivo.js muestra
```
- Procesa solo 20 documentos como prueba
- Usa colección `normas_test`
- Verifica que todo funcione correctamente

### 2. Procesamiento Completo
```bash
node procesar-json-masivo.js completo
```
- Procesa todos los ~400k documentos
- Usa la colección configurada en `.env`
- Puede tomar varias horas

### 3. Resumir Procesamiento Interrumpido
```bash
node procesar-json-masivo.js resumir
```
- Continúa desde donde se quedó
- Lee el archivo `progress_normas_juridicas.json`
- Útil si el proceso se interrumpe

## 📈 Monitoreo del Progreso

### Archivos de Control Generados:

1. **`progress_normas_juridicas.json`**: Guarda el progreso actual
2. **`errors_normas_juridicas.log`**: Log detallado de errores
3. **Logs en consola**: Progreso en tiempo real cada 50 documentos

### Ejemplo de Output:
```
🚀 Iniciando procesamiento de archivo JSON masivo...

📋 Configuración del procesamiento:
   📄 Archivo JSON: c:\Users\ljutr\Desktop\buscadorDB.normas.json
   🗂️ Colección: normas_juridicas
   📦 Tamaño de lote: 25
   📊 Máximo documentos: Todos
   ⏱️ Log cada: 50 documentos

📦 Procesando lote 1: documentos 0 a 24
✅ Lote completado: 23 procesados, 1 errores, 1 saltados
📊 Total acumulado: 23 procesados, 1 errores, 1 saltados

📈 Progreso: 50 procesados, 2 errores
```

## ⚡ Optimizaciones Implementadas

### Para Manejar 400K Documentos:

1. **Procesamiento por Lotes**: Evita saturar memoria y servicios
2. **Pausa entre Lotes**: Previene sobrecarga del servicio de embeddings
3. **Resumir Progreso**: Continúa desde donde se interrumpió
4. **Validación de Documentos**: Salta documentos inválidos automáticamente
5. **Chunking Inteligente**: Divide textos largos en chunks de 1000 caracteres
6. **Manejo de Errores**: Registra errores sin detener el proceso
7. **IDs Únicos**: Genera IDs enteros únicos para Qdrant

## 🔧 Estructura de Datos Indexados

### Metadatos Extraídos de cada documento:
- **Identificación**: `idSentence`, `idNorm`, `compuesto`
- **Contenido**: `titulo_norma`, texto completo vectorizado
- **Organismos**: `organismos[]`, `fuente`
- **Fechas**: `fecha_publicacion`, `fecha_promulgacion`, `inicio_vigencia`, `fin_vigencia`
- **Clasificación**: `materias[]`, `categorias_norma[]`, `terminos_libres[]`
- **Estado**: `derogado`, `tipo_version_s`, `observaciones[]`
- **Estructura**: `estructura[]`, `tipos_numeros[]`
- **Vigencia**: `vigencias[]`, `vigencias_version_norma[]`

### Chunking de Texto:
- **Tamaño**: 1000 caracteres por chunk
- **Overlap**: 100 caracteres entre chunks
- **Separadores**: Párrafos, oraciones, palabras
- **Vectores**: 1024 dimensiones por chunk

## ⏱️ Estimación de Tiempo

### Para 400K documentos:
- **Con lotes de 25**: ~16,000 lotes
- **Con pausa de 3s**: ~13 horas de pausa
- **Tiempo de procesamiento**: ~2-3 segundos por documento
- **Total estimado**: **24-30 horas**

### Recomendaciones:
1. **Ejecutar en servidor**: Proceso largo, mejor en servidor dedicado
2. **Monitorear memoria**: Verificar uso de RAM durante el proceso
3. **Backup de progreso**: Los archivos de progreso permiten resumir
4. **Ejecutar de noche**: Proceso automatizado, no requiere supervisión

## 🚨 Solución de Problemas

### Error 413 (Request Too Large):
- Documentos muy grandes se mueven automáticamente a carpeta `/error`
- Reducir `BATCH_SIZE` si persiste

### Servicio de Embeddings No Disponible:
- Verificar que `http://ms-vector.governare.ai/embed` esté funcionando
- Aumentar `PAUSE_MS` para reducir carga

### Memoria Insuficiente:
- Reducir `BATCH_SIZE` a 10-15
- Aumentar `PAUSE_MS` a 5000-10000

### Qdrant No Disponible:
- Verificar conexión a `http://ms-qdrant-8f82e7cd-8cc2.governare.ai`
- Revisar configuración de colección

## 📊 Verificación Post-Procesamiento

### Consultar estadísticas de la colección:
```bash
curl http://ms-qdrant-8f82e7cd-8cc2.governare.ai/collections/normas_juridicas
```

### Buscar documentos:
```javascript
const IndexarQdrant = require('./functions/IndexarQdrant');
const indexador = new IndexarQdrant('', 'normas_juridicas');
const resultados = await indexador.search('resolución ministerial', 10, 0.7);
console.log(resultados);
```

## 🎉 ¡Listo para Procesar!

1. **Ejecuta primero**: `node procesar-json-masivo.js muestra`
2. **Si funciona bien**: `node procesar-json-masivo.js completo`
3. **Si se interrumpe**: `node procesar-json-masivo.js resumir`

El sistema está optimizado para manejar el volumen masivo de datos de manera eficiente y resiliente.
