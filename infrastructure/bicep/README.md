# Azure Infrastructure as Code (Bicep)

This directory contains Bicep templates for deploying Flowgrid Platform to Azure.

## Planned Templates

- `main.bicep` - Main deployment orchestration
- `container-apps.bicep` - Azure Container Apps environment
- `database.bicep` - PostgreSQL Flexible Server
- `redis.bicep` - Azure Cache for Redis
- `networking.bicep` - Virtual Network and NSGs
- `monitoring.bicep` - Application Insights

## Usage (Coming Soon)

```bash
az deployment sub create \
  --location westeurope \
  --template-file main.bicep \
  --parameters @parameters.json
```

## Prerequisites

- Azure CLI with Bicep extension
- Appropriate Azure subscription permissions
- Service Principal for CI/CD (optional)

---

*Templates will be added as we migrate to Azure Container Apps.*
