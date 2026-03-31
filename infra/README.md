# Infrastructure

Esta carpeta contiene la capa de infraestructura de Azure gestionada con Bicep.

## Recursos actuales

- Azure Cosmos DB for NoSQL en modo serverless
- Base de datos SQL de Cosmos DB
- Contenedores iniciales:
  - `rooms`
  - `participant-custom-permissions`

## Estructura

- [`main.bicep`](/Users/flavioontaneda/voycelink/voycelink-prime/infra/main.bicep): punto de entrada del despliegue
- [`modules/cosmosdb-serverless.bicep`](/Users/flavioontaneda/voycelink/voycelink-prime/infra/modules/cosmosdb-serverless.bicep): módulo reusable de Cosmos DB serverless
- [`main.parameters.json`](/Users/flavioontaneda/voycelink/voycelink-prime/infra/main.parameters.json): parámetros base para un entorno `dev`

## Despliegue

1. Crear o seleccionar un resource group:

```bash
az group create \
  --name rg-voycelink-dev \
  --location eastus
```

2. Desplegar la infraestructura:

```bash
az deployment group create \
  --resource-group rg-voycelink-dev \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

## Personalización

- Puedes forzar el nombre del account con `cosmosAccountName`.
- Puedes cambiar contenedores y partition keys con `cosmosContainers`.
- El nombre de la base se controla con `cosmosDatabaseName`.

## Outputs esperados

El despliegue expone:

- `cosmosAccountName`
- `cosmosEndpoint`
- `cosmosDatabaseName`
- `cosmosConnectionStringSettingName`
- `cosmosContainers`

## Nota operativa

En este entorno local no estaba instalado Bicep CLI, así que no pude ejecutar una validación compilando la plantilla aquí. Los archivos quedaron listos para ejecutarse con Azure CLI en una máquina o pipeline que tenga `az bicep install` disponible.
