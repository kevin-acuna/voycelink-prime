targetScope = 'resourceGroup'

@description('Logical application name used to derive resource names.')
param projectName string = 'voycelink'

@description('Deployment environment name.')
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Optional explicit Cosmos DB account name. Leave empty to generate one.')
param cosmosAccountName string = ''

@description('Cosmos DB SQL database name.')
param cosmosDatabaseName string = 'voycelink'

@description('Cosmos DB SQL containers to provision.')
param cosmosContainers array = [
  {
    name: 'rooms'
    partitionKeyPath: '/roomId'
  }
  {
    name: 'participant-custom-permissions'
    partitionKeyPath: '/roomId'
  }
]

@description('Tags applied to all supported resources.')
param tags object = {}

var normalizedProjectName = toLower(replace(projectName, '-', ''))
var normalizedEnvironmentName = toLower(replace(environmentName, '-', ''))
var generatedCosmosAccountName = take('cdb${normalizedProjectName}${normalizedEnvironmentName}${uniqueString(resourceGroup().id)}', 44)
var resolvedCosmosAccountName = empty(cosmosAccountName) ? generatedCosmosAccountName : toLower(cosmosAccountName)

module cosmos './modules/cosmosdb-serverless.bicep' = {
  name: 'cosmosdb-serverless'
  params: {
    accountName: resolvedCosmosAccountName
    databaseName: cosmosDatabaseName
    location: location
    containers: cosmosContainers
    tags: union(tags, {
      environment: environmentName
      workload: projectName
      managedBy: 'bicep'
    })
  }
}

output cosmosAccountName string = cosmos.outputs.accountName
output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosDatabaseName string = cosmos.outputs.databaseName
output cosmosConnectionStringSettingName string = 'COSMOS_DB_CONNECTION_STRING'
output cosmosContainers array = cosmos.outputs.containerNames
