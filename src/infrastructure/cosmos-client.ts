import { CosmosClient } from '@azure/cosmos';
import { config } from '../config';
import { logger } from '../logger';

type CosmosContainers = {
  rooms: ReturnType<ReturnType<CosmosClient['database']>['container']>;
  participantPermissions: ReturnType<
    ReturnType<CosmosClient['database']>['container']
  >;
};

let _client: CosmosClient | null = null;
let _database: ReturnType<CosmosClient['database']> | null = null;
let _containers: CosmosContainers | null = null;

function getClient() {
  if (!_client) {
    _client = new CosmosClient(config.cosmos.connectionString!);
    _database = _client.database(config.cosmos.databaseName);
    _containers = {
      rooms: _database.container(config.cosmos.roomsContainerName),
      participantPermissions: _database.container(
        config.cosmos.participantPermissionsContainerName,
      ),
    };
  }
  return { client: _client, database: _database!, containers: _containers! };
}

export const cosmos = {
  get client() {
    return getClient().client;
  },
  get database() {
    return getClient().database;
  },
  get containers() {
    return getClient().containers;
  },
};

export async function verifyCosmosConnection() {
  const { database } = getClient();
  const response = await database.read();

  logger.info(
    {
      databaseId: response.resource?.id,
      roomsContainer: config.cosmos.roomsContainerName,
      participantPermissionsContainer:
        config.cosmos.participantPermissionsContainerName,
    },
    'Cosmos DB connection verified',
  );

  return response.resource;
}
