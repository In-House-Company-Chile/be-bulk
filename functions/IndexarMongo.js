require('dotenv').config();
const { MongoClient } = require('mongodb');


const uri = process.env.MONGO_URL;
const client = new MongoClient(uri);

class IndexarMongo {
	constructor(doc, dbName, collection) { 
		this.doc = doc;
		this.dbName = dbName;
		this.collection = collection;
	}

	static async create(doc, dbName, collection) {
		return await new IndexarMongo(doc, dbName, collection).indexar();
	}

	async indexar() {
		try {
			await client.connect();
			const db = client.db(this.dbName);
			const collection = db.collection(this.collection);

			if (await collection.countDocuments({ idNorm: this.doc.idNorm }) > 0) {
				console.log(`⚠️ La norma con idNorm ${this.doc.idNorm} ya existe en la colección.`);
				return 'OK';
			}

			const meta = this.doc.data?.metadatos || {};
			const tiposNumeros = meta.tipos_numeros?.[0] || {};

			const entrada = {
				idNorm: this.doc.idNorm,
				planeText: this.doc.planeText || '',
				compuesto: tiposNumeros.compuesto || '',
				titulo_norma: meta.titulo_norma || '',
				organismos: meta.organismos || [],
				fecha_publicacion: meta.fecha_publicacion || '',
				fecha_promulgacion: meta.fecha_promulgacion || '',
				tipo_version_s: meta.tipo_version_s || '',
				inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
				fin_vigencia: meta.vigencia?.fin_vigencia || '',
				data: this.doc.data || {},
			};

			await collection.insertOne(entrada);
			console.log(`✅ Indexado en Mongo: ${this.doc.idNorm}`);
		}

		catch (e) {
			console.error('❌ Error al indexar:', e);
		} finally {
			await client.close();
		}
	}
}

module.exports = IndexarMongo;
