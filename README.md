# voycelink-prime

Proyecto para meeting premium de Voycelink.

## Scripts

- `npm run build`: compila TypeScript a `dist/` y copia los assets estaticos.
- `npm run dev`: ejecuta el servidor TypeScript en modo watch.
- `npm start`: arranca la version compilada desde `dist/server.js`.

## Infraestructura

- La capa de infraestructura vive en [`infra/`](/Users/flavioontaneda/voycelink/voycelink-prime/infra).
- Actualmente incluye despliegue con Bicep para Azure Cosmos DB serverless.
- La guia de uso esta en [`infra/README.md`](/Users/flavioontaneda/voycelink/voycelink-prime/infra/README.md).
