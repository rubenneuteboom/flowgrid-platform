#!/bin/bash

# Test script for Multi-Tenant Agent Registry
# Prerequisites: 
# - Services running (agent-service on :3001)
# - Valid JWT token with tenantId claim

set -e

echo "=== FlowGrid Agent Registry Test Suite ==="
echo ""

# Configuration
AGENT_SERVICE_URL="http://localhost:3001"
JWT_TOKEN="${FLOWGRID_TEST_TOKEN:-demo-jwt-token-here}"

echo "📋 Using Agent Service: $AGENT_SERVICE_URL"
echo "🔑 Token: ${JWT_TOKEN:0:20}..."
echo ""

# Test 1: List all running agents
echo "Test 1: GET /api/registry/agents"
echo "-----------------------------------"
curl -s -X GET "$AGENT_SERVICE_URL/api/registry/agents" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" | jq '.' || echo "❌ Failed"
echo ""
echo ""

# Test 2: Search by pattern
echo "Test 2: GET /api/registry/agents/search?pattern=specialist"
echo "------------------------------------------------------------"
curl -s -X GET "$AGENT_SERVICE_URL/api/registry/agents/search?pattern=specialist" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" | jq '.' || echo "❌ Failed"
echo ""
echo ""

# Test 3: Search by skill (if you have agents with skills)
echo "Test 3: GET /api/registry/agents/search?skill=incident"
echo "-------------------------------------------------------"
curl -s -X GET "$AGENT_SERVICE_URL/api/registry/agents/search?skill=incident" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" | jq '.' || echo "❌ Failed"
echo ""
echo ""

# Test 4: Get specific agent (replace with actual agent ID)
AGENT_ID="${TEST_AGENT_ID:-00000000-0000-0000-0000-000000000000}"
echo "Test 4: GET /api/registry/agents/$AGENT_ID"
echo "-------------------------------------------"
curl -s -X GET "$AGENT_SERVICE_URL/api/registry/agents/$AGENT_ID" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" | jq '.' || echo "❌ Failed (expected if agent doesn't exist)"
echo ""
echo ""

# Test 5: Register agent (simulate agent startup)
echo "Test 5: POST /api/registry/agents/$AGENT_ID/register"
echo "-----------------------------------------------------"
curl -s -X POST "$AGENT_SERVICE_URL/api/registry/agents/$AGENT_ID/register" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://test-agent.azurewebsites.net",
    "metadata": {
      "version": "1.0.0",
      "status": "healthy",
      "hostname": "test-host"
    }
  }' | jq '.' || echo "❌ Failed (expected if agent doesn't exist)"
echo ""
echo ""

# Test 6: Unregister agent (simulate agent shutdown)
echo "Test 6: DELETE /api/registry/agents/$AGENT_ID/unregister"
echo "---------------------------------------------------------"
curl -s -X DELETE "$AGENT_SERVICE_URL/api/registry/agents/$AGENT_ID/unregister" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" || echo "❌ Failed (expected if agent doesn't exist)"
echo ""
echo ""

echo "=== Test Suite Complete ==="
echo ""
echo "💡 Tips:"
echo "  - To test with real data, create an agent and set deployment.status to 'running'"
echo "  - Generate a valid JWT with: node scripts/generate-test-token.js"
echo "  - Set environment variables: export TEST_AGENT_ID=<uuid> FLOWGRID_TEST_TOKEN=<jwt>"
echo ""
