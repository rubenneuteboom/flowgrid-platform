/*
 * FlowGrid Two Agents Demo - Azure Infrastructure
 * 
 * Creates:
 * - Service Bus namespace with 2 queues
 * - 2 Function Apps (Coordinator + Specialist)
 * - Application Insights for monitoring
 */

@description('Location for all resources')
param location string = resourceGroup().location

@description('Base name for resources')
param baseName string = 'flowgrid-demo'

@description('Environment suffix')
param env string = 'dev'

// ============================================================================
// Variables
// ============================================================================

var uniqueSuffix = uniqueString(resourceGroup().id)
var serviceBusName = '${baseName}-sb-${uniqueSuffix}'
var storageAccountName = replace('${baseName}st${uniqueSuffix}', '-', '')
var appInsightsName = '${baseName}-ai-${env}'
var coordinatorFuncName = '${baseName}-coordinator-${env}'
var specialistFuncName = '${baseName}-specialist-${env}'
var appServicePlanName = '${baseName}-plan-${env}'

// ============================================================================
// Service Bus
// ============================================================================

resource serviceBus 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: serviceBusName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

resource coordinatorQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBus
  name: 'coordinator-inbox'
  properties: {
    lockDuration: 'PT1M'
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: false
    defaultMessageTimeToLive: 'P1D'
  }
}

resource specialistQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBus
  name: 'specialist-inbox'
  properties: {
    lockDuration: 'PT1M'
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: false
    defaultMessageTimeToLive: 'P1D'
  }
}

resource serviceBusAuthRule 'Microsoft.ServiceBus/namespaces/AuthorizationRules@2022-10-01-preview' = {
  parent: serviceBus
  name: 'FunctionAppAccess'
  properties: {
    rights: ['Listen', 'Send', 'Manage']
  }
}

// ============================================================================
// Storage Account (for Functions)
// ============================================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: take(storageAccountName, 24)
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// ============================================================================
// Application Insights
// ============================================================================

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

// ============================================================================
// App Service Plan (Consumption)
// ============================================================================

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

// ============================================================================
// Coordinator Function App
// ============================================================================

resource coordinatorFunc 'Microsoft.Web/sites@2023-01-01' = {
  name: coordinatorFuncName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'SERVICE_BUS_CONNECTION', value: serviceBusAuthRule.listKeys().primaryConnectionString }
      ]
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
}

// ============================================================================
// Specialist Function App
// ============================================================================

resource specialistFunc 'Microsoft.Web/sites@2023-01-01' = {
  name: specialistFuncName
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'SERVICE_BUS_CONNECTION', value: serviceBusAuthRule.listKeys().primaryConnectionString }
      ]
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
}

// ============================================================================
// Outputs
// ============================================================================

output serviceBusNamespace string = serviceBus.name
output serviceBusConnection string = serviceBusAuthRule.listKeys().primaryConnectionString
output coordinatorUrl string = 'https://${coordinatorFunc.properties.defaultHostName}'
output specialistUrl string = 'https://${specialistFunc.properties.defaultHostName}'
output appInsightsKey string = appInsights.properties.InstrumentationKey
