# Propuesta de Nueva Arquitectura y Mejoras

Para lograr que el sistema sea automatizado, modular, inyectable y altamente escalable para poder integrar el "Diario Oficial" u otras fuentes de jurisprudencia en el futuro, proponemos la siguiente modernización tecnológica.

## 1. Stack Tecnológico General (Propuesta)

La recomendación principal se inclina por **TypeScript + NestJS**, ya que soluciona de raíz el problema que mencionas: **"necesito que sea inyectable"**. NestJS tiene la inyección de dependencias como ciudadano de primera clase aportando una estructura "Enterprise", además de que el equipo ya maneja JavaScript (Axios, LangChain.js, Node.js).

### Opción A (Recomendada y Continua): TypeScript + NestJS + LangChain.js
- **Lenguaje:** TypeScript (Las interfaces son críticas para obligar a que todos los Scrapers compartan el mismo formato de salida).
- **Framework Core:** **NestJS**. Proporciona inyección de dependencias nativa, separación por módulos (Módulo de Base de Datos, Módulo de Scraping, etc.).
- **Procesamiento de IA y Text Splitting:** **LangChain.js** (Ya lo usas, pero lo usaríamos tipado y mucho más limpio en sus cadenas).
- **Orquestación y Schedulers:** `@nestjs/schedule` para controlar los CronJobs sin archivos extra de cron.
- **Manejo de Tareas y Reintentos:** **BullMQ (con Redis)** para desencadenar el trabajo en formato de colas asíncronas fiables.
- **ORM / Consultas PSQL:** Prisma o TypeORM (En lugar de enviar queries SQL raw pesadas mediante `pg`, usar un ORM tipado protege contra errores y permite un modelado más sólido).

### Opción B (Alternativa Intensiva de Datos): Python + FastAPI + LlamaIndex
- **Lenguaje:** Python 3.11+.
- **Framework Core de IA:** **LlamaIndex** es hoy superior a LangChain para procesos complejos RAG y se lleva muy bien con Qdrant.
- **Inyección de Dependencias:** Usar librerías como `dependency-injector` o simplemente estructurar código mediante protocolos Pydantic.
- **Extractor/Scraping:** En vez de Axios/Cheerio, en Python se usaría **Scrapy** o `httpx` para el manejo avanzado y eficiente de sesiones multipart.
- **Orquestación:** `Celery` para workers + `APScheduler` para la automatización cron, y Redis.

***Nota:** Asumiremos para esta mejora la Opción A (NestJS) dado que es la forma más rápida y sólida de refactorizar tu actual `be-bulk` manteniendo similitud con lo que el equipo JS ya domina.*

---

## 2. Abstracción Dinámica (Patrón Puertos y Adaptadores)

Ahora, Postgres, Qdrant y el modelo de Embeddings se convierten en **Dependencias Estáticas (Servicios Inyectados)** y la obtención de datos se vuelve **Dinámica (Implementaciones Intercambiables)**.

```typescript
// 1. EL PUERTO (La Regla/Interfaz Común)
export interface IDataSourceScraper {
  sourceName: string;
  fetchAvailableDocuments(cursor: string): Promise<RawData[]>;
  processDocument(data: RawData): Promise<ParsedDocument>;
}

// 2. LAS IMPLEMENTACIONES (El Diario Oficial o Normas BCN)
@Injectable()
export class BCNScraperService implements IDataSourceScraper {
  sourceName = 'BCN_NORMAS';
  // Lógica de requests web para Ley Chile...
}

@Injectable()
export class DiarioOficialScraperService implements IDataSourceScraper {
  sourceName = 'DIARIO_OFICIAL';
  // Lógica de requests web para el Diario Oficial...
}
```

Al utilizar esta interfaz, el Orquestador/Worker sólo pide usar un integrador genérico (`IDataSourceScraper`), y sin tocar nada de código core, mañana puedes crear la clase `ContraloriaScraperService` y funcionará de inmediato. Qdrant y Postgres serán simplemente `@Inject(QdrantService)` en un paso final general.

---

## 3. Puntos Críticos de Mejora en la Nueva Versión

Estas resoluciones resuelven la "deuda técnica" del Legacy:

### A. Sustitución de `while()` / `sleep()` por Cola de Mensajes (BullMQ + Redis)
- **Problema actual:** El código depende de un loop infinito pausándose mediante `await sleep(x)`. Si se cae el proceso, o se bloquea el internet un segundo, el hilo completo muere y el batch se pierde o duplica trabajo.
- **Solución:** Los Cronjobs despertarán, por ejemplo, cada Viernes a las 23:00. El cron **solamente** calcula qué páginas hay que fetchear y las agregará a una lista de Redis (una Cola). Los *Workers* procesarán una a una esa cola. Si un request falla al servidor del PJUD, simplemente el "Job" se marca como fallido y se ordena **reintentarse a los 5 minutos automáticamente**, sin afectar a los otros 10.000 documentos que sí están descargando bien.

### B. Persistencia Central de Estado (Adiós `.log`)
- **Problema actual:** Archivos locales en disco como `logs/last_norm.log` registran el estado del trabajo. Esto impide ejecutar contenedores (Docker) libremente, pues el archivo se borra y la app empieza a buscar desde el número 1.
- **Solución:** Se creará una tabla en Postgres llamada `scraper_cursors` que guarde en la BD el nombre del Scraper (ej. `BCN`) y el último ID (ej. `1215894`) actualizado en tiempo real.

### C. Sistema de Ofuscación y Proxy Rotativo (Evadir Bloqueos)
- **Problema actual:** Depender únicamente de un retraso de tiempo y reiniciar 10 o 100 veces por errores `MAX_ERRORES_CONSECUTIVOS` no es muy eficiente contra sistemas cerrados.
- **Solución:** Implementar un middleware unificado para Axios / HttpModule que altere dinámicamente el `User-Agent` o disponga de una lista de Proxies. Así, el sistema se verá como varios usuarios orgánicos y no sufrirá penalizaciones de firewall (WAFs).

### D. Centralización del Qdrant (Single Source of Truth)
- **Problema actual:** Hay fragmentación como `IndexarQdrant.js` y `IndexarQdrantV2.js` con variables de entorno/hardcodeo duplicadas.
- **Solución:** En NestJS, habrá un único, sólido y testeado `QdrantService`. El motor se conectará al iniciar la app usando conexión *Keep-Alive* configurada, validará las colecciones requeridas, y los diferentes scrapers lo invocarán, reduciendo redundancia y unificando el control de calidad vectorial.
