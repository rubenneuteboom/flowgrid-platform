#!/bin/bash
set -e

echo "🚀 FlowGrid Two Agents Demo - Deployment"
echo "========================================="

# Configuration
RESOURCE_GROUP="rg-flowgrid-demo"
LOCATION="westeurope"

# Check Azure CLI
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Install: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi

# Check login
echo "📋 Checking Azure login..."
az account show > /dev/null 2>&1 || az login

# Create resource group
echo "📁 Creating resource group: $RESOURCE_GROUP"
az group create -n $RESOURCE_GROUP -l $LOCATION -o none

# Deploy infrastructure
echo "🏗️  Deploying infrastructure (Bicep)..."
OUTPUTS=$(az deployment group create \
  -g $RESOURCE_GROUP \
  -f infra/main.bicep \
  --query "properties.outputs" \
  -o json)

# Extract outputs
COORDINATOR_URL=$(echo $OUTPUTS | jq -r '.coordinatorUrl.value')
SPECIALIST_URL=$(echo $OUTPUTS | jq -r '.specialistUrl.value')
SERVICE_BUS=$(echo $OUTPUTS | jq -r '.serviceBusConnection.value')

echo "✅ Infrastructure deployed!"
echo "   Coordinator: $COORDINATOR_URL"
echo "   Specialist:  $SPECIALIST_URL"

# Build TypeScript
echo "📦 Building TypeScript..."
npm install
npm run build

# Create local.settings.json for local testing
cat > local.settings.json << EOF
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "SERVICE_BUS_CONNECTION": "$SERVICE_BUS"
  }
}
EOF
echo "✅ Created local.settings.json"

# Deploy functions
echo "🚀 Deploying Coordinator Function..."
COORDINATOR_NAME=$(echo $COORDINATOR_URL | sed 's|https://||' | sed 's|.azurewebsites.net||')
func azure functionapp publish $COORDINATOR_NAME --typescript

echo "🚀 Deploying Specialist Function..."
SPECIALIST_NAME=$(echo $SPECIALIST_URL | sed 's|https://||' | sed 's|.azurewebsites.net||')
func azure functionapp publish $SPECIALIST_NAME --typescript

echo ""
echo "✅ Deployment complete!"
echo "========================================="
echo ""
echo "🧪 Test commands:"
echo ""
echo "# Simple greeting (local):"
echo "curl -X POST $COORDINATOR_URL/api/agent/request \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"task\": \"simple-greeting\"}'"
echo ""
echo "# Analyze data (delegated):"
echo "curl -X POST $COORDINATOR_URL/api/agent/request \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"task\": \"analyze-data\"}'"
echo ""
echo "# Agent cards:"
echo "curl $COORDINATOR_URL/.well-known/agent.json"
echo "curl $SPECIALIST_URL/.well-known/agent.json"
echo ""
echo "📊 Monitor in Azure Portal: Application Insights"
