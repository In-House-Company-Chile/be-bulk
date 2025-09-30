require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
	host: process.env.POSTGRES_HOST,
	port: process.env.POSTGRES_PORT,
	database: process.env.POSTGRES_DATABASE, // o el nombre de tu base de datos
	user: process.env.POSTGRES_USER,
	password: process.env.POSTGRES_PASSWORD,
	max: 10, // máximo de conexiones en el pool
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

class IndexarPsql {
	constructor(doc, tableName, metadata, idDoc) { 
		this.doc = doc;
		this.tableName = tableName || 'normas';
		this.metadata = metadata;
		this.idDoc = idDoc;
	}

	static async create(doc, tableName, metadata, idDoc) {
		return await new IndexarPsql(doc, tableName, metadata, idDoc).indexar();
	}

	async indexar() {
		const client = await pool.connect();
		try {
			// Verificar si el documento ya existe
			const existeQuery = 'SELECT COUNT(*) FROM documents WHERE id = $1';
			const existeResult = await client.query(existeQuery, [this.idDoc]);
			
			if (parseInt(existeResult.rows[0].count) > 0) {
				console.log(`⚠️ La norma con ID ${this.idDoc} ya existe en la tabla.`);
				return 'INSERTED';
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

			const values = [
				String(this.idDoc),                    // id
				this.tableName || 'test',        // collection 
				`${this.idDoc}.json`,         // filename
				`/path/to/${this.idDoc}.json`, // file_path
				JSON.stringify(this.doc),          // content (documento completo)
				JSON.stringify(this.metadata),          // metadata (campos estructurados)
				contentSize                        // file_size
			];

			await client.query(insertQuery, values);
			console.log(`✅ Indexado en PostgreSQL: ${this.idDoc}`);
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
