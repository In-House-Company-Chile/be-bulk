const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

const uri = 'http://localhost:8000';

const UploadDocumentAi = async (filePath, chunkSize, extension, namespace, deleteBot, metadata) => {
    try {
        const data = {
            "filePath": filePath,
            "chunkSize": chunkSize,
            "extension": extension,
            "namespace": namespace,
            "deleteBot": deleteBot,
            "metadata": metadata
        };
        const result = await axios.post(`${uri}/v2/upload-document/`, { data: data },)
        return result.data;
    } catch (e) {
        console.error(e)
    }
};

const LoadDocumentAi = async (filePath) => {
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));

        const data = {
            'file': form,
        };
        const response = await axios.post(`${uri}/load-document/`, data.file, {
            headers: {
                ...form.getHeaders(),
            },
        });

        return response.data;
    } catch (e) {
        console.error(e)
    }
};

const DeleteDocumentAi = async (filePath) => {
    try {
        const result = await axios.delete(`${uri}/document`, { data: { path: filePath } });
        return result.data;
    } catch (e) {
        console.error('delete')
    }
};

const loadNormasFromJSON = async (directory) => {
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.json'));
    const normas = [];

    for (const file of files) {
        const filePath = path.join(directory, file);
        const jsonData = fs.readFileSync(filePath, 'utf8');

        try {
            const parsedJson = JSON.parse(jsonData);
            normas.push({
                id: parsedJson.idNorm || '',
                fecha_publicacion: parsedJson.data.metadatos.fecha_publicacion || '',
                fecha_promulgacion: parsedJson.data.metadatos.fecha_promulgacion || '',
                planeText: parsedJson.planeText || '',
            });
        } catch (error) {
            console.error(`Error al procesar ${file}:`);
        }
    }

    return normas;
};

const upload = async (directory) => {
    try {
        const files = fs.readdirSync(directory).filter(file => file.endsWith('.json'));
        const normas = await loadNormasFromJSON(directory);

        // Asegurar que exista la carpeta 'filtred'
        if (!fs.existsSync('filtred')) {
            fs.mkdirSync('filtred');
        }

        for (const [index, item] of normas.entries()) {
            const fileName = `norma_${item.id}_filtered.txt`;
            const filePathFiltred = path.join('filtred', fileName);

            // 1. Guardar archivo plano
            fs.writeFileSync(filePathFiltred, item.planeText);
            console.log("🚀 ~ Guardado:", filePathFiltred);

            try {
                // 2. Cargar a DocumentAI
                const res = await LoadDocumentAi(filePathFiltred);

                // 3. Subir con metadatos
                await UploadDocumentAi(res.data,800,'txt','pruebaNormas1','false',{metadata: {id: item.id,fechaPublicacion: item.fecha_publicacion,fechaPromulgacion: item.fecha_promulgacion}});

                // 4. Eliminar temporal
                await DeleteDocumentAi(filePathFiltred);

            } catch (error) {
                console.error(`Error procesando norma ${item.id} (índice ${index}):`, error.message);
            }
        }

        return { status: 'created' };

    } catch (e) {
        console.error('upload error:', e);
    }
};


upload('norms')
    .then((response) => {
        console.log('Upload completed:', response);
    })
    .catch((error) => {
        console.error('Error during upload:');
    });