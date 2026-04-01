import { Injectable, Logger } from '@nestjs/common';
import { IDataSourceScraper, RawData, ParsedDocument } from '../../core/interfaces/data-source-scraper.interface';
import axios from 'axios';
import * as he from 'he';

@Injectable()
export class BcnNormasScraperService implements IDataSourceScraper {
  readonly sourceName = 'BCN_NORMAS';
  private readonly logger = new Logger(BcnNormasScraperService.name);

  async fetchAvailableDocuments(cursor: string): Promise<RawData[]> {
    const nextId = parseInt(cursor, 10);
    if (isNaN(nextId)) {
      throw new Error(`Cursor inválido para BCN_NORMAS: ${cursor}`);
    }

    const url = `https://nuevo.leychile.cl/servicios/Navegar/get_norma_json?idNorma=${nextId}`;
    try {
      const response = await axios.get(url, { responseType: 'json', timeout: 15000 });
      
      if (response.data && response.data.metadatos) {
        return [
          {
            externalId: nextId.toString(),
            sourceUrl: url,
            rawHtml: JSON.stringify(response.data),
            fetchedAt: new Date(),
          },
        ];
      }
      // No se encontró la norma, retornamos vacío para que el iterador decida si asume error transitorio o suma 1 al cursor.
      return [];
    } catch (e) {
      this.logger.error(`Error HTTP obteniendo norma ${nextId}: ${e.message}`);
      throw e; // Lanzar para que BullMQ registre el fallo y reintente el job
    }
  }

  async processDocument(raw: RawData): Promise<ParsedDocument> {
    let data: any;
    try {
      data = JSON.parse(raw.rawHtml);
    } catch (e) {
      throw new Error(`Error parseando raw data: ${e.message}`);
    }

    const htmlUnificado = this.mergeHtml(data);
    const planeText = this.extractText(htmlUnificado);

    const meta = data.metadatos || {};
    const tiposNumeros = meta.tipos_numeros?.[0] || {};

    const metadata = {
      compuesto: tiposNumeros.compuesto || '',
      titulo_norma: meta.titulo_norma || '',
      organismos: meta.organismos || [],
      fecha_publicacion: meta.fecha_publicacion || '',
      fecha_promulgacion: meta.fecha_promulgacion || '',
      tipo_version_s: meta.tipo_version_s || '',
      inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
      fin_vigencia: meta.vigencia?.fin_vigencia || '',
      tag: 'norma',
    };

    let publishedAt: Date | undefined;
    if (meta.fecha_publicacion) {
      publishedAt = new Date(meta.fecha_publicacion);
    }

    return {
      externalId: raw.externalId,
      sourceName: this.sourceName,
      title: meta.titulo_norma || `Norma LeyChile ID ${raw.externalId}`,
      body: planeText,
      metadata,
      publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    };
  }

  async chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]> {
    // Actualmente se delega el chunking a LlamaIndex.TS.
    // Retornamos el documento completo base.
    return [doc];
  }

  /**
   * Extrae y unifica nodos hijos HTML del JSON de LeyChie
   */
  private mergeHtml(obj: any): string {
    let text = '';
    if (obj.html && Array.isArray(obj.html)) {
      obj.html.forEach((element: any) => {
        if (element.t) {
          const cleanedHTML = element.t
            .replace(/<span[^>]*>.*?<\/span>/gi, '')
            .replace(/<div[^>]*class=["']?n rnp["']?[^>]*>.*?<\/div>/gis, '')
            .replace(/<a[^>]*>(.*?)<\/a>/gi, '$1');

          text += cleanedHTML + '\n';
        }

        if (element.h && Array.isArray(element.h)) {
          text += this.mergeHtml({ html: element.h }) + '\n';
        }
      });
    }
    return text.trim();
  }

  /**
   * Elimina cualquier tab HTML restante y decodifica el texto (e.g. &#xD3 -> O).
   */
  private extractText(html: string): string {
    if (!html) return '';
    let text = html.replace(/<\/?[^>]+(>|$)/g, '').trim();
    text = he.decode(text);
    return text;
  }
}
