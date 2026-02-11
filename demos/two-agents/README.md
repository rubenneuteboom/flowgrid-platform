# FlowGrid Two Agents Demo 🤖↔️🤖

A fun proof-of-concept showing two A2A-compliant agents communicating via Azure Service Bus.

## Architecture

```
┌─────────────────┐                    ┌─────────────────┐
│   HTTP Client   │                    │  Application    │
│   (You!)        │                    │  Insights       │
└────────┬────────┘                    └────────▲────────┘
         │ POST /api/agent/request              │ logs
         ▼                                      │
┌─────────────────────────────────────────────────────────┐
│                    COORDINATOR AGENT                     │
│  • Receives external requests                           │
│  • Decides: handle locally or delegate?                 │
│  • Sends tasks to Specialist via Service Bus            │
└─────────────────────────┬───────────────────────────────┘
                          │ Service Bus
                          │ (specialist-inbox)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    SPECIALIST AGENT                      │
│  • analyze-data: Returns insights with confidence       │
│  • generate-report: Creates formatted reports           │
│  • validate-config: Validates configurations            │
└─────────────────────────┬───────────────────────────────┘
                          │ Service Bus
                          │ (coordinator-inbox)
                          ▼
                    [Response logged]
```

## Quick Start

### 1. Deploy Infrastructure

```bash
# Create resource group
az group create -n rg-flowgrid-demo -l westeurope

# Deploy infrastructure
az deployment group create \
  -g rg-flowgrid-demo \
  -f infra/main.bicep \
  --query "properties.outputs"
```

### 2. Build & Deploy Functions

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy Coordinator
cd coordinator
func azure functionapp publish flowgrid-demo-coordinator-dev

# Deploy Specialist  
cd ../specialist
func azure functionapp publish flowgrid-demo-specialist-dev
```

### 3. Test It!

```bash
# Simple greeting (handled locally by Coordinator)
curl -X POST https://flowgrid-demo-coordinator-dev.azurewebsites.net/api/agent/request \
  -H "Content-Type: application/json" \
  -d '{"task": "simple-greeting"}'

# Analyze data (delegated to Specialist)
curl -X POST https://flowgrid-demo-coordinator-dev.azurewebsites.net/api/agent/request \
  -H "Content-Type: application/json" \
  -d '{"task": "analyze-data", "data": {"source": "metrics"}}'

# Generate report
curl -X POST https://flowgrid-demo-coordinator-dev.azurewebsites.net/api/agent/request \
  -H "Content-Type: application/json" \
  -d '{"task": "generate-report"}'
```

### 4. Get Agent Cards

```bash
# Coordinator's A2A card
curl https://flowgrid-demo-coordinator-dev.azurewebsites.net/.well-known/agent.json

# Specialist's A2A card
curl https://flowgrid-demo-specialist-dev.azurewebsites.net/.well-known/agent.json
```

## Local Development

```bash
# Start with Azurite (local storage) and Service Bus emulator
npm run build
func start

# Test locally
curl -X POST http://localhost:7071/api/agent/request \
  -H "Content-Type: application/json" \
  -d '{"task": "analyze-data"}'
```

## Message Flow

1. **Client** sends POST to Coordinator
2. **Coordinator** receives request, creates correlation ID
3. **Coordinator** decides:
   - `simple-greeting` → handle locally, return immediately
   - Other tasks → delegate to Specialist
4. **Coordinator** sends message to `specialist-inbox` queue
5. **Specialist** receives message, processes task
6. **Specialist** sends response to `coordinator-inbox` queue
7. **Coordinator** receives response, logs result

## A2A Protocol Compliance

Both agents expose `/.well-known/agent.json` with:
- ✅ `name`, `url`, `version` (required)
- ✅ `protocolVersion: "0.2"`
- ✅ `description`
- ✅ `provider` object
- ✅ `capabilities` (streaming, pushNotifications, stateTransitionHistory)
- ✅ `skills[]` with `id`, `name`, `description`, `tags`, `examples`

## Cost Estimate

Using Azure Consumption plan:
- **Service Bus Standard**: ~€8/month base
- **Functions**: First 1M executions free
- **Storage**: ~€0.02/GB/month
- **Total**: ~€10/month for demo usage

## Cleanup

```bash
az group delete -n rg-flowgrid-demo --yes --no-wait
```

---

Built with ❤️ by FlowGrid Platform
