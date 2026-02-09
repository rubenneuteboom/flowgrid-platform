# Flowgrid Platform - Deployment Setup Guide

Complete step-by-step guide for deploying Flowgrid Platform to Azure Container Apps or VPS.

## 📋 Table of Contents

1. [Deployment Options](#deployment-options)
2. [Prerequisites](#prerequisites)
3. [Option A: Azure Container Apps](#option-a-azure-container-apps-200-400month)
4. [Option B: VPS Deployment](#option-b-vps-deployment-10-50month)
5. [GitHub Actions Setup](#github-actions-setup)
6. [First Deployment Checklist](#first-deployment-checklist)
7. [Monitoring & Operations](#monitoring--operations)
8. [Troubleshooting](#troubleshooting)

---

## Deployment Options

| Feature | VPS (€10-50/mo) | Azure Container Apps (€200-400/mo) |
|---------|-----------------|-----------------------------------|
| **Setup Time** | 1-2 hours | 2-4 hours |
| **Scaling** | Manual | Automatic |
| **SSL/TLS** | Manual (Certbot) | Automatic |
| **Monitoring** | Self-managed | Built-in |
| **Backups** | Manual scripts | Automated |
| **Best For** | Budget, <100 users | Production, 100+ users |

**Recommendation:** Start with VPS for testing, upgrade to Container Apps when you have paying customers.

---

## Prerequisites

### All Deployments

- [ ] GitHub repository with access token
- [ ] Domain name (e.g., `flowgrid.io` or `api.flowgrid.io`)
- [ ] Anthropic API key (for AI features)
- [ ] SMTP credentials (optional, for email)

### For Azure Deployment

- [ ] Azure subscription with credits
- [ ] Azure CLI installed (`az --version`)
- [ ] Bicep CLI installed (`az bicep version`)

### For VPS Deployment

- [ ] VPS server (Hetzner, DigitalOcean, Vultr, etc.)
- [ ] SSH access to VPS
- [ ] Domain pointing to VPS IP

---

## Option A: Azure Container Apps (€200-400/month)

### Step 1: Create Azure Resources

```bash
# Login to Azure
az login

# Set subscription
az account set --subscription "Your-Subscription-Name"

# Create resource group
az group create \
  --name rg-flowgrid-staging \
  --location westeurope

# Generate strong passwords
export POSTGRES_PASSWORD=$(openssl rand -base64 32)
export JWT_SECRET=$(openssl rand -base64 64)

# Deploy infrastructure using Bicep
az deployment group create \
  --resource-group rg-flowgrid-staging \
  --template-file infrastructure/azure/main.bicep \
  --parameters environment=staging \
               postgresAdminPassword="$POSTGRES_PASSWORD" \
               jwtSecret="$JWT_SECRET" \
               anthropicApiKey="$ANTHROPIC_API_KEY"

# Note the outputs (save these!)
az deployment group show \
  --resource-group rg-flowgrid-staging \
  --name main \
  --query properties.outputs
```

### Step 2: Configure Container Registry

```bash
# Get ACR name from deployment
ACR_NAME=$(az deployment group show \
  --resource-group rg-flowgrid-staging \
  --name main \
  --query properties.outputs.acrName.value -o tsv)

# Login to ACR
az acr login --name $ACR_NAME

# Build and push one service to test
cd services/agent-service
docker build -t $ACR_NAME.azurecr.io/agent-service:v1 .
docker push $ACR_NAME.azurecr.io/agent-service:v1
```

### Step 3: Create Service Principal for GitHub Actions

```bash
# Create service principal with contributor access
az ad sp create-for-rbac \
  --name "flowgrid-github-actions" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/rg-flowgrid-staging \
  --json-auth

# Save the JSON output - this is your AZURE_CREDENTIALS secret!
# It looks like:
# {
#   "clientId": "...",
#   "clientSecret": "...",
#   "subscriptionId": "...",
#   "tenantId": "..."
# }

# Grant ACR push access
az role assignment create \
  --assignee {clientId-from-above} \
  --role AcrPush \
  --scope /subscriptions/{subscription-id}/resourceGroups/rg-flowgrid-staging/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME

# Grant Key Vault access
az role assignment create \
  --assignee {clientId-from-above} \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/{subscription-id}/resourceGroups/rg-flowgrid-staging/providers/Microsoft.KeyVault/vaults/kv-flowgrid-staging
```

### Step 4: Run Database Migrations

```bash
# Get PostgreSQL connection string
POSTGRES_HOST=$(az postgres flexible-server show \
  --resource-group rg-flowgrid-staging \
  --name flowgrid-staging-postgres \
  --query fullyQualifiedDomainName -o tsv)

# Connect and run migrations
psql "host=$POSTGRES_HOST dbname=flowgrid user=flowgrid_admin password=$POSTGRES_PASSWORD sslmode=require" \
  -f infrastructure/migrations/001_initial_schema.sql

# Seed demo data (optional)
psql "host=$POSTGRES_HOST dbname=flowgrid user=flowgrid_admin password=$POSTGRES_PASSWORD sslmode=require" \
  -f infrastructure/seed-dev-data.sql
```

### Step 5: Verify Deployment

```bash
# Get gateway URL
GATEWAY_URL=$(az containerapp show \
  --name gateway \
  --resource-group rg-flowgrid-staging \
  --query properties.configuration.ingress.fqdn -o tsv)

# Test health endpoints
curl https://$GATEWAY_URL/health
curl https://$GATEWAY_URL/api/auth/health
curl https://$GATEWAY_URL/api/agents/health
```

### Azure Cost Breakdown

| Resource | Staging | Production |
|----------|---------|------------|
| Container Apps Environment | €25-50 | €50-100 |
| Container Apps (6 services) | €50-100 | €150-300 |
| PostgreSQL Flexible Server | €15-30 | €100-200 |
| Redis Cache | €15 | €30-50 |
| Key Vault | €3-5 | €3-5 |
| Networking/Egress | €10-20 | €20-40 |
| **Total** | **€120-250** | **€350-700** |

---

## Option B: VPS Deployment (€10-50/month)

### Step 1: Create VPS Server

1. Sign up at [Hetzner Cloud](https://www.hetzner.com/cloud) (recommended for EU)
2. Create server:
   - **OS:** Ubuntu 22.04 LTS
   - **Type:** CX21 (2 vCPU, 4GB RAM) - €4.50/month
   - **Location:** Falkenstein or Helsinki
   - **SSH Key:** Add your public key

### Step 2: Initial Server Setup

```bash
# SSH into server
ssh root@YOUR_VPS_IP

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
apt-get install -y docker-compose-plugin

# Install useful tools
apt-get install -y git curl htop fail2ban ufw

# Setup firewall
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 8080/tcp  # Gateway
ufw enable

# Create application directory
mkdir -p /opt/flowgrid
cd /opt/flowgrid

# Clone repository
git clone https://github.com/rubenneuteboom/flowgrid-platform.git .

# Create environment file
cp infrastructure/.env.example infrastructure/.env
nano infrastructure/.env
# Add your secrets:
# DB_PASSWORD=your-secure-password
# JWT_SECRET=your-jwt-secret
# ANTHROPIC_API_KEY=sk-ant-...
```

### Step 3: Deploy Services

```bash
cd /opt/flowgrid/infrastructure

# Start infrastructure (postgres, redis)
docker compose up -d postgres redis

# Wait for postgres to be ready
sleep 10

# Run migrations
docker compose exec -T postgres psql -U flowgrid -d flowgrid -f /docker-entrypoint-initdb.d/001_initial_schema.sql

# Start all services
docker compose up -d

# Check status
docker compose ps
```

### Step 4: Setup SSL with Let's Encrypt

```bash
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Get certificate (replace with your domain)
certbot certonly --standalone -d api.flowgrid.io

# Configure nginx for SSL (update nginx.conf)
# Add SSL certificate paths and redirect HTTP to HTTPS
```

### Step 5: Setup Automatic Updates

```bash
# Create update script
cat > /opt/flowgrid/update.sh << 'EOF'
#!/bin/bash
cd /opt/flowgrid
git pull origin main
cd infrastructure
docker compose pull
docker compose up -d
docker image prune -f
EOF

chmod +x /opt/flowgrid/update.sh

# Add cron for daily backups
crontab -e
# Add: 0 2 * * * cd /opt/flowgrid/infrastructure && docker compose exec -T postgres pg_dump -U flowgrid flowgrid | gzip > /opt/flowgrid/backups/$(date +\%Y\%m\%d).sql.gz
```

### VPS Cost Breakdown

| Provider | Specs | Monthly Cost |
|----------|-------|--------------|
| Hetzner CX21 | 2 vCPU, 4GB RAM, 40GB SSD | €4.50 |
| Hetzner CX31 | 2 vCPU, 8GB RAM, 80GB SSD | €8.50 |
| Hetzner CX41 | 4 vCPU, 16GB RAM, 160GB SSD | €15.90 |
| DigitalOcean | 2 vCPU, 4GB RAM | $24 |
| Vultr | 2 vCPU, 4GB RAM | $20 |

---

## GitHub Actions Setup

### Required Secrets

Go to **GitHub → Repository → Settings → Secrets and variables → Actions**

#### For Azure Deployment

| Secret | Description | How to Get |
|--------|-------------|------------|
| `AZURE_CREDENTIALS` | Service principal JSON | See Step 3 above |

#### For VPS Deployment

| Secret | Description | Example |
|--------|-------------|---------|
| `VPS_HOST` | Server IP address | `49.12.100.50` |
| `VPS_USER` | SSH username | `root` or `deploy` |
| `VPS_SSH_KEY` | Private SSH key | Contents of `~/.ssh/id_rsa` |
| `VPS_PATH` | Project path | `/opt/flowgrid` |

### Generate SSH Key for VPS

```bash
# Generate new key pair
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/flowgrid_deploy

# Copy public key to VPS
ssh-copy-id -i ~/.ssh/flowgrid_deploy.pub root@YOUR_VPS_IP

# Add private key as GitHub secret (VPS_SSH_KEY)
cat ~/.ssh/flowgrid_deploy
```

### Create GitHub Environments

1. Go to **Settings → Environments**
2. Create environments:
   - `staging` - Auto-deploy on push to main
   - `production` - Require manual approval
   - `staging-vps` - VPS staging
   - `production-vps` - VPS production

---

## First Deployment Checklist

### Pre-Deployment

- [ ] All services pass local tests (`docker compose up` works locally)
- [ ] Environment files configured with real secrets
- [ ] Domain DNS configured (A record pointing to server/Azure)
- [ ] GitHub secrets added
- [ ] Database migrations tested locally

### Deploy to Staging

- [ ] Run `deploy-azure-container-apps.yml` or `deploy-vps.yml` manually
- [ ] Check GitHub Actions logs for errors
- [ ] Verify all services are healthy (`/health` endpoints)
- [ ] Test login with demo credentials
- [ ] Test API endpoints via gateway

### Post-Deployment

- [ ] Configure custom domain in Azure Portal or nginx
- [ ] Enable SSL/HTTPS
- [ ] Set up monitoring/alerting
- [ ] Configure backup schedule
- [ ] Document any custom configuration

---

## Monitoring & Operations

### Azure Container Apps

```bash
# View logs
az containerapp logs show \
  --name agent-service \
  --resource-group rg-flowgrid-staging \
  --follow

# View metrics in Azure Portal
# Go to: Container Apps → agent-service → Metrics

# Scale manually
az containerapp update \
  --name agent-service \
  --resource-group rg-flowgrid-staging \
  --min-replicas 2 \
  --max-replicas 10
```

### VPS Operations

```bash
# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f agent-service

# Check resource usage
docker stats

# Restart specific service
docker compose restart agent-service

# View container status
docker compose ps
```

---

## Troubleshooting

### Common Issues

#### "Container keeps restarting"
```bash
# Check logs
docker compose logs agent-service --tail=100

# Common causes:
# - DATABASE_URL not set correctly
# - Missing environment variables
# - Port already in use
```

#### "Cannot connect to database"
```bash
# Test connection
docker compose exec agent-service node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => console.log('Connected!')).catch(console.error);
"
```

#### "Health check failing"
```bash
# Test locally
curl http://localhost:3001/health

# Check if service is running
docker compose ps
```

#### "Azure deployment fails"
```bash
# Check deployment logs
az deployment group show \
  --resource-group rg-flowgrid-staging \
  --name main

# Check container app logs
az containerapp logs show --name agent-service --resource-group rg-flowgrid-staging
```

---

## Support

- **Documentation:** `/docs/` folder
- **Issues:** GitHub Issues
- **Architecture:** `/docs/ARCHITECTURE.md`
- **Local Setup:** `/README.md`
