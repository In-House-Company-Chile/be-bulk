# Descargador de Datos de Tricel

Este script permite descargar automáticamente todos los datos de la API de Tricel (Tribunal Calificador de Elecciones) con paginación automática.

## Características

- ✅ Descarga automática con paginación (100 resultados por página)
- ✅ Manejo dinámico de cookies/sesiones
- ✅ Archivos JSON separados por página
- ✅ Manejo de errores y reintentos automáticos
- ✅ Resumen consolidado de la descarga
- ✅ Control de tasa de peticiones (para no sobrecargar el servidor)

## Instalación

Las dependencias necesarias ya están en el `package.json` del proyecto:
- `axios` para peticiones HTTP
- `fs` (nativo de Node.js) para manejo de archivos

## Uso Rápido

### 1. Obtener Cookies Actualizadas

Las cookies de sesión expiran periódicamente, por lo que necesitas obtener cookies frescas:

1. Abre tu navegador y ve a: https://tricel.lexsoft.cl
2. Abre las herramientas de desarrollador (F12)
3. Ve a la pestaña "Network" o "Red"
4. Realiza cualquier búsqueda en la página
5. Busca la petición que contiene `searchBandeja`
6. En los headers de la petición, copia el valor completo del header `Cookie`

### 2. Ejecutar el Script

```bash
# Usando el ejemplo simple
node ejemplo_tricel.js

# O directamente
node descargarTricel.js
```

### 3. Actualizar Cookies en el Código

Reemplaza la variable `cookies` en el archivo con tus cookies actuales:

```javascript
const cookies = 'TUS_COOKIES_AQUI';
```

## Estructura de Archivos Generados

```
tricel_data/
├── tricel_page_001.json    # Página 1 (resultados 1-100)
├── tricel_page_002.json    # Página 2 (resultados 101-200)
├── ...
├── tricel_page_086.json    # Página 86 (últimos resultados)
├── summary.json            # Resumen de la descarga
└── errors.json            # Errores (si los hubo)
```

## Formato de Datos

Cada archivo JSON contiene:

```json
{
  "resultsCount": 8597,
  "results": [
    {
      "fragmento": [],
      "fragmentoEscrito": [],
      "fragmentoSentencia": [],
      "tipo": "Demanda",
      "fecha": 1756440000000,
      "rol": "1925-2025",
      "caratula": null,
      "iniciales": "",
      "causaId": 13595,
      "estadoEscrito": "Parcial",
      "observaciones": "",
      "tipoProcedimiento": "Jurisdiccional",
      "materia": "Reclamación interpuesta contra el padrón electoral...",
      "partes": ["Jorge Rolando Cubillos Aracena"],
      "formaInicio": "Reclamación",
      "documentoEscritoIngresoId": 167731,
      "documentoSentenciaId": 168358,
      "textoEscritoIngreso": null,
      "textoEscritoSentencia": null,
      "era": 2025,
      "tipoDocumento": "Sentencia"
    }
  ]
}
```

## Uso Programático

```javascript
const TricelDownloader = require('./descargarTricel');

async function miDescarga() {
    const downloader = new TricelDownloader();
    
    // Configurar cookies
    downloader.setCookies('tus_cookies_aqui');
    
    try {
        // Descargar todo
        await downloader.downloadAllPages();
        
        // Crear resumen
        await downloader.createSummary();
        
        console.log('¡Completado!');
    } catch (error) {
        console.error('Error:', error.message);
    }
}
```

## Configuración Avanzada

Puedes personalizar el comportamiento modificando las propiedades de la clase:

```javascript
const downloader = new TricelDownloader();

// Cambiar el tamaño de página (por defecto: 100)
downloader.pageSize = 50;

// Cambiar directorio de salida (por defecto: './tricel_data')
downloader.outputDir = './mis_datos_tricel';

// Configurar headers adicionales
downloader.headers['User-Agent'] = 'Mi-Bot/1.0';
```

## Manejo de Errores

El script incluye manejo robusto de errores:

- **Cookies expiradas**: Detecta automáticamente y proporciona instrucciones
- **Errores de red**: Reintentos automáticos con pausa
- **Timeouts**: Timeout de 30 segundos por petición
- **Registro de errores**: Guarda errores en `errors.json` para revisión

## Consideraciones Importantes

1. **Respeta el servidor**: El script incluye pausas entre lotes de peticiones
2. **Cookies dinámicas**: Las cookies expiran, necesitarás actualizarlas periódicamente
3. **Tamaño de datos**: ~8597 resultados = ~86 archivos JSON (~varios MB)
4. **Tiempo de ejecución**: Dependiendo de la conexión, puede tomar varios minutos

## Solución de Problemas

### Error: "Cookies expiradas"
- Obtén cookies frescas siguiendo los pasos del punto 1
- Asegúrate de copiar el header `Cookie` completo

### Error: "ECONNABORTED" (Timeout)
- Verifica tu conexión a internet
- El servidor puede estar lento, el script reintentará automáticamente

### Archivos faltantes
- Revisa el archivo `errors.json` para ver qué páginas fallaron
- Puedes ejecutar el script nuevamente, saltará las páginas ya descargadas

## Ejemplo de Resumen Generado

```json
{
  "timestamp": "2025-01-11T10:30:00.000Z",
  "totalFiles": 86,
  "totalResults": 8597,
  "totalProcessedResults": 8597,
  "filesProcessed": [
    {
      "file": "tricel_page_001.json",
      "resultsCount": 100,
      "page": 1
    }
  ]
}
```
