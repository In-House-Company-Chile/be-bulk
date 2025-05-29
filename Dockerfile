FROM node:20.13.1-buster-slim

WORKDIR /app

COPY . .

RUN npm i

# Comando para ejecutar el servidor
CMD ["npm", "run", "start", "--host", "0.0.0.0"]
