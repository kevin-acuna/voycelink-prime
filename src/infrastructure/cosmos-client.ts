import { CosmosClient } from '@azure/cosmos';
import { config } from '../config';
import { logger } from '../logger';

const cosmosClient = new CosmosClient(config.cosmos.connectionString);
const database = cosmosClient.database(config.cosmos.databaseName);

export const cosmos = {
  client: cosmosClient,
  database,
  containers: {
    rooms: database.container(config.cosmos.roomsContainerName),
    participantPermissions: database.container(config.cosmos.participantPermissionsContainerName),
  },
};

export async function verifyCosmosConnection() {
  const response = await database.read();

  logger.info(
    {
      databaseId: response.resource?.id,
      roomsContainer: config.cosmos.roomsContainerName,
      participantPermissionsContainer: config.cosmos.participantPermissionsContainerName,
    },
    'Cosmos DB connection verified'
  );

  return response.resource;
}
