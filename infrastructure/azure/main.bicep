// =============================================================================
// Flowgrid Platform - Azure Infrastructure
// Deploys: Container Registry, Container Apps Environment, PostgreSQL, Redis, 
//          Key Vault, Virtual Network
// =============================================================================

@description('Environment name (staging, production)')
@allowed(['staging', 'production'])
param environment string = 'staging'

@description('Azure region for resources')
param location string = resourceGroup().location

@description('PostgreSQL administrator password')
@secure()
param postgresAdminPassword string

@description('JWT secret for auth service')
@secure()
param jwtSecret string

@description('Anthropic API key (optional)')
@secure()
param anthropicApiKey string = ''

// =============================================================================
// Variables
// =============================================================================

var resourcePrefix = 'flowgrid-${environment}'
var acrName = 'flowgridacr${environment}'
var keyVaultName = 'kv-flowgrid-${environment}'

var tags = {
  environment: environment
  project: 'flowgrid-platform'
  managedBy: 'bicep'
}

// =============================================================================
// Virtual Network
// =============================================================================

resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
  name: '${resourcePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: '10.0.0.0/21'
          delegations: [
            {
              name: 'containerApps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'database'
        properties: {
          addressPrefix: '10.0.8.0/24'
          delegations: [
            {
              name: 'flexibleServer'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: 'redis'
        properties: {
          addressPrefix: '10.0.9.0/24'
        }
      }
    ]
  }
}

// =============================================================================
// Azure Container Registry
// =============================================================================

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: environment == 'production' ? 'Standard' : 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
  }
}

// =============================================================================
// Log Analytics Workspace
// =============================================================================

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${resourcePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// =============================================================================
// Container Apps Environment
// =============================================================================

resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${resourcePrefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: vnet.properties.subnets[0].id
      internal: false
    }
    zoneRedundant: environment == 'production'
  }
}

// =============================================================================
// PostgreSQL Flexible Server
// =============================================================================

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${resourcePrefix}.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource privateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: '${resourcePrefix}-postgres-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: '${resourcePrefix}-postgres'
  location: location
  tags: tags
  sku: {
    name: environment == 'production' ? 'Standard_D2s_v3' : 'Standard_B1ms'
    tier: environment == 'production' ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '15'
    administratorLogin: 'flowgrid_admin'
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: environment == 'production' ? 128 : 32
    }
    backup: {
      backupRetentionDays: environment == 'production' ? 35 : 7
      geoRedundantBackup: environment == 'production' ? 'Enabled' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: vnet.properties.subnets[1].id
      privateDnsZoneArmResourceId: privateDnsZone.id
    }
    highAvailability: {
      mode: environment == 'production' ? 'ZoneRedundant' : 'Disabled'
    }
  }
  dependsOn: [
    privateDnsZoneLink
  ]
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgres
  name: 'flowgrid'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// =============================================================================
// Redis Cache
// =============================================================================

resource redis 'Microsoft.Cache/redis@2023-04-01' = {
  name: '${resourcePrefix}-redis'
  location: location
  tags: tags
  properties: {
    sku: {
      name: environment == 'production' ? 'Standard' : 'Basic'
      family: 'C'
      capacity: environment == 'production' ? 1 : 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'volatile-lru'
    }
  }
}

// =============================================================================
// Key Vault
// =============================================================================

resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Store secrets in Key Vault
resource jwtSecretKv 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  parent: keyVault
  name: 'jwt-secret'
  properties: {
    value: jwtSecret
  }
}

resource dbUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  parent: keyVault
  name: 'database-url'
  properties: {
    value: 'postgres://flowgrid_admin:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/flowgrid?sslmode=require'
  }
}

resource redisUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  parent: keyVault
  name: 'redis-url'
  properties: {
    value: 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'
  }
}

resource anthropicSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = if (!empty(anthropicApiKey)) {
  parent: keyVault
  name: 'anthropic-api-key'
  properties: {
    value: anthropicApiKey
  }
}

// =============================================================================
// Outputs
// =============================================================================

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output containerAppEnvId string = containerAppEnv.id
output containerAppEnvName string = containerAppEnv.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output redisHost string = redis.properties.hostName
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output vnetId string = vnet.id

// Cost estimates (monthly)
output estimatedMonthlyCost object = {
  environment: environment
  containerAppsEnv: environment == 'production' ? '€50-100' : '€25-50'
  containerApps: environment == 'production' ? '€150-300' : '€50-100'
  postgresql: environment == 'production' ? '€100-200' : '€15-30'
  redis: environment == 'production' ? '€30-50' : '€15'
  keyVault: '€3-5'
  networking: '€10-20'
  total: environment == 'production' ? '€350-700' : '€120-250'
}
