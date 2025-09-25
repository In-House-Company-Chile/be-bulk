require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
	host: 'localhost',
	port: 5432,
	database: 'postgres', // o el nombre de tu base de datos
	user: 'postgres',
	password: 'mipassword',
	max: 10, // máximo de conexiones en el pool
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

class IndexarPsql {
	constructor(doc, tableName) { 
		this.doc = doc;
		this.tableName = tableName || 'normas';
	}

	static async create(doc, tableName) {
		return await new IndexarPsql(doc, tableName).indexar();
	}

	async indexar() {
		const client = await pool.connect();
		try {
			// Verificar si el documento ya existe
			const existeQuery = 'SELECT COUNT(*) FROM documents WHERE id = $1';
			const existeResult = await client.query(existeQuery, [this.doc.idNorm]);
			
			if (parseInt(existeResult.rows[0].count) > 0) {
				console.log(`⚠️ La norma con ID ${this.doc.idNorm} ya existe en la tabla.`);
				return 'OK';
			}

			// Preparar los datos para insertar (similar al patrón Python)
			const insertQuery = `
				INSERT INTO documents (
					id, 
					collection,
					filename,
					file_path,
					content,
					metadata,
					file_size
				) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
			`;

			// Calcular el tamaño aproximado del contenido
			const contentSize = JSON.stringify(this.doc).length;
			
			// Preparar metadata similar al formato original
			const meta = this.doc.data?.metadatos || {};
			const tiposNumeros = meta.tipos_numeros?.[0] || {};
			
			const metadata = {
				titulo_norma: meta.titulo_norma || '',
				organismos: meta.organismos || [],
				fecha_publicacion: meta.fecha_publicacion || '',
				fecha_promulgacion: meta.fecha_promulgacion || '',
				tipo_version_s: meta.tipo_version_s || '',
				inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
				fin_vigencia: meta.vigencia?.fin_vigencia || '',
				compuesto: tiposNumeros.compuesto || '',
				planeText: this.doc.planeText || ''
			};

			const values = [
				String(this.doc.idNorm),                    // id
				this.tableName || 'normas',        // collection 
				`${this.doc.idNorm}.json`,         // filename
				`/path/to/${this.doc.idNorm}.json`, // file_path
				JSON.stringify(this.doc),          // content (documento completo)
				JSON.stringify(metadata),          // metadata (campos estructurados)
				contentSize                        // file_size
			];

			await client.query(insertQuery, values);
			const resData = await client.query('SELECT content FROM documents WHERE id = $1', [this.doc.idNorm]);
			console.log("🚀 ~ IndexarPsql ~ indexar ~ resData:", resData.rows[0].content)
			console.log(`✅ Indexado en PostgreSQL: ${this.doc.idNorm}`);
			return 'OK';
		}
		catch (e) {
			console.error('❌ Error al indexar en PostgreSQL:', e);
			console.error('Detalles del error:', e.message);
			throw e;
		} finally {
			client.release();
		}
	}
}

module.exports = IndexarPsql;
