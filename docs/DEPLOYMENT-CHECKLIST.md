# Multi-Tenant Agent Registry - Deployment Checklist

**Project:** FlowGrid Platform - Agent Registry  
**Version:** 1.0  
**Date:** 2026-02-12

## Pre-Deployment

### Code Review

- [x] Agent Registry endpoints implemented (`/services/agent-service/src/index.ts`)
- [x] Code generation updated (`/services/wizard-service/src/routes/generate.ts`)
- [x] Nginx routes configured (`/infrastructure/nginx/conf.d/routes.conf`)
- [x] TypeScript compilation successful (no errors)
- [x] Test suite created (`/services/agent-service/tests/registry.test.ts`)
- [x] Documentation complete (4 documents, 44+ pages)

### Code Quality

- [x] No TypeScript errors
- [x] All functions have proper error handling
- [x] Logging added for all operations
- [x] Tenant validation on all endpoints
- [x] SQL queries parameterized (no SQL injection risk)
- [x] JWT authentication enforced

### Documentation

- [x] Multi-tenant execution design (`MULTI-TENANT-EXECUTION.md`)
- [x] Implementation guide (`AGENT-REGISTRY-IMPLEMENTATION.md`)
- [x] Implementation summary (`IMPLEMENTATION-SUMMARY.md`)
- [x] Quick start guide (`AGENT-REGISTRY-QUICK-START.md`)
- [x] Test suite with 15+ test cases

## Phase 1: Backend Deployment

### Database

- [ ] Verify `agents.config` column is JSONB
- [ ] Verify GIN index exists on `agents.config`
- [ ] Verify `agent_skills` table exists
- [ ] Verify `agent_capabilities` table exists
- [ ] Run database migration (if needed):
  ```bash
  psql $DATABASE_URL -f infrastructure/migrations/verify_config_jsonb.sql
  ```
- [ ] Verify indexes:
  ```sql
  SELECT indexname FROM pg_indexes WHERE tablename = 'agents';
  ```

### Agent Service Deployment

- [ ] Build Docker image:
  ```bash
  cd services/agent-service
  npm run build
  docker build -t flowgrid/agent-service:v1.1.0 .
  ```
- [ ] Tag image:
  ```bash
  docker tag flowgrid/agent-service:v1.1.0 flowgrid/agent-service:latest
  ```
- [ ] Push to registry:
  ```bash
  docker push flowgrid/agent-service:v1.1.0
  docker push flowgrid/agent-service:latest
  ```
- [ ] Update Kubernetes deployment:
  ```bash
  kubectl set image deployment/agent-service agent-service=flowgrid/agent-service:v1.1.0
  ```
- [ ] Verify deployment:
  ```bash
  kubectl rollout status deployment/agent-service
  kubectl get pods -l app=agent-service
  ```

### Nginx Update

- [ ] Backup current nginx config:
  ```bash
  kubectl get configmap nginx-routes -o yaml > nginx-routes-backup.yaml
  ```
- [ ] Apply new routes:
  ```bash
  kubectl apply -f infrastructure/nginx/conf.d/routes.conf
  ```
- [ ] Reload nginx:
  ```bash
  kubectl exec -it deployment/nginx-ingress -- nginx -s reload
  ```
- [ ] Verify routes:
  ```bash
  kubectl exec -it deployment/nginx-ingress -- nginx -T | grep "location /api/registry"
  ```

### Endpoint Verification

- [ ] Health check:
  ```bash
  curl https://api.flowgrid.io/health
  ```
- [ ] Registry list (should work):
  ```bash
  curl -X GET https://api.flowgrid.io/api/registry/agents \
    -H "Authorization: Bearer $JWT_TOKEN"
  ```
- [ ] Registry search (should work):
  ```bash
  curl -X GET "https://api.flowgrid.io/api/registry/agents/search?q=test" \
    -H "Authorization: Bearer $JWT_TOKEN"
  ```
- [ ] Verify 401 without auth:
  ```bash
  curl -X GET https://api.flowgrid.io/api/registry/agents
  # Should return 401
  ```

## Phase 2: Code Generation Deployment

### Wizard Service Deployment

- [ ] Build Docker image:
  ```bash
  cd services/wizard-service
  npm run build
  docker build -t flowgrid/wizard-service:v1.1.0 .
  ```
- [ ] Push to registry:
  ```bash
  docker push flowgrid/wizard-service:v1.1.0
  docker push flowgrid/wizard-service:latest
  ```
- [ ] Update Kubernetes deployment:
  ```bash
  kubectl set image deployment/wizard-service wizard-service=flowgrid/wizard-service:v1.1.0
  ```
- [ ] Verify deployment:
  ```bash
  kubectl rollout status deployment/wizard-service
  ```

### Code Generation Testing

- [ ] Generate test agent:
  ```bash
  curl -X POST https://api.flowgrid.io/api/wizard/generate-code \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"agent": {"name": "Test Agent", ...}}'
  ```
- [ ] Verify generated code includes:
  - [ ] `FLOWGRID_REGISTRY_URL` environment variable
  - [ ] `discoverAgents()` helper function
  - [ ] `getAgentCard()` helper function
  - [ ] `registerWithRegistry()` helper function
- [ ] Verify TypeScript compiles:
  ```bash
  # Save generated code to test-agent/index.ts
  tsc --noEmit test-agent/index.ts
  ```

## Phase 3: Testing

### Automated Tests

- [ ] Run test suite:
  ```bash
  cd services/agent-service
  npm test -- registry.test.ts
  ```
- [ ] Verify all tests pass:
  - [ ] List agents
  - [ ] Get agent by ID
  - [ ] Search agents
  - [ ] Register agent
  - [ ] Unregister agent
  - [ ] Tenant isolation
  - [ ] Authentication

### Integration Testing

- [ ] Create test tenant:
  ```sql
  INSERT INTO tenants (id, name, slug) VALUES 
    ('test-tenant-id', 'Test Tenant', 'test-tenant');
  ```
- [ ] Create test user:
  ```sql
  INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES
    ('test-tenant-id', 'test@example.com', 'hash', 'Test User', 'admin');
  ```
- [ ] Generate JWT for test user:
  ```bash
  node scripts/generate-test-jwt.js test-tenant-id test-user-id
  ```
- [ ] Create test agent:
  ```bash
  curl -X POST https://api.flowgrid.io/api/agents \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Test Agent",
      "type": "Specialist",
      "config": {
        "deployment": {
          "status": "running",
          "endpoint": "https://test-agent.example.com"
        }
      }
    }'
  ```
- [ ] Verify agent appears in registry:
  ```bash
  curl -X GET https://api.flowgrid.io/api/registry/agents \
    -H "Authorization: Bearer $TEST_JWT"
  ```
- [ ] Test agent registration:
  ```bash
  curl -X POST https://api.flowgrid.io/api/registry/agents/$AGENT_ID/register \
    -H "Authorization: Bearer $TEST_JWT" \
    -H "Content-Type: application/json" \
    -d '{"endpoint": "https://test-agent.example.com"}'
  ```
- [ ] Clean up test data:
  ```sql
  DELETE FROM agents WHERE tenant_id = 'test-tenant-id';
  DELETE FROM users WHERE tenant_id = 'test-tenant-id';
  DELETE FROM tenants WHERE id = 'test-tenant-id';
  ```

### Security Testing

- [ ] Test tenant isolation:
  ```bash
  # Create two test tenants and agents
  # Try to access Tenant B's agent with Tenant A's JWT
  curl -X GET https://api.flowgrid.io/api/registry/agents/$TENANT_B_AGENT_ID \
    -H "Authorization: Bearer $TENANT_A_JWT"
  # Should return 404
  ```
- [ ] Test authentication:
  ```bash
  # Try to access without JWT
  curl -X GET https://api.flowgrid.io/api/registry/agents
  # Should return 401
  ```
- [ ] Test invalid JWT:
  ```bash
  curl -X GET https://api.flowgrid.io/api/registry/agents \
    -H "Authorization: Bearer invalid-token"
  # Should return 401
  ```

### Performance Testing (Optional)

- [ ] Load test registry list endpoint:
  ```bash
  ab -n 1000 -c 10 -H "Authorization: Bearer $JWT_TOKEN" \
    https://api.flowgrid.io/api/registry/agents
  ```
- [ ] Verify response times:
  - [ ] p50 < 50ms
  - [ ] p95 < 100ms
  - [ ] p99 < 200ms
- [ ] Monitor database during load test:
  ```sql
  SELECT * FROM pg_stat_activity WHERE state = 'active';
  ```

## Phase 4: Monitoring & Alerting

### Application Insights

- [ ] Create Application Insights dashboard:
  - [ ] Registry endpoint request count
  - [ ] Registry endpoint response times
  - [ ] Failed authentication attempts
  - [ ] Tenant ID mismatch errors
  - [ ] Agent registration/unregistration events
- [ ] Set up alerts:
  - [ ] Response time > 1000ms (p95)
  - [ ] Error rate > 1%
  - [ ] Failed authentication rate > 5%

### Database Monitoring

- [ ] Monitor `agents` table size per tenant:
  ```sql
  SELECT tenant_id, COUNT(*) FROM agents GROUP BY tenant_id;
  ```
- [ ] Monitor query performance:
  ```sql
  SELECT * FROM pg_stat_statements 
  WHERE query LIKE '%api/registry%' 
  ORDER BY mean_exec_time DESC;
  ```
- [ ] Set up slow query alerts (queries > 500ms)

### Service Bus Monitoring (Future)

- [ ] Monitor queue depth per tenant
- [ ] Set up alerts for queue depth > 1000
- [ ] Monitor message age (messages older than 5 minutes)

## Phase 5: Documentation & Communication

### Developer Documentation

- [ ] Publish API documentation:
  - [ ] Add to developer portal
  - [ ] Include code examples
  - [ ] Add to Postman collection
- [ ] Update developer onboarding docs:
  - [ ] Add registry setup steps
  - [ ] Add environment variables section
  - [ ] Add example code snippets

### Team Communication

- [ ] Announce deployment in team chat:
  ```
  🚀 Agent Registry v1.0 deployed!
  
  New features:
  - Multi-tenant agent discovery
  - A2A Protocol v0.2 support
  - Self-registration for agents
  
  Docs: https://docs.flowgrid.io/agent-registry
  Quick Start: https://docs.flowgrid.io/agent-registry-quick-start
  ```
- [ ] Send email to stakeholders
- [ ] Schedule demo for interested teams
- [ ] Create Slack/Discord channel: `#agent-registry`

### Customer Communication (if applicable)

- [ ] Draft release notes
- [ ] Update changelog
- [ ] Notify pilot customers
- [ ] Schedule training session

## Phase 6: Post-Deployment

### Week 1: Monitoring

- [ ] Daily check of error logs
- [ ] Monitor Application Insights dashboard
- [ ] Check database performance
- [ ] Review tenant isolation logs
- [ ] Address any issues immediately

### Week 2: Optimization

- [ ] Review performance metrics
- [ ] Identify slow queries
- [ ] Consider Redis caching if needed
- [ ] Optimize database indexes if needed
- [ ] Review and adjust rate limits

### Week 3: Feedback

- [ ] Gather developer feedback
- [ ] Identify pain points
- [ ] Create backlog items for improvements
- [ ] Plan next iteration

### Month 1: Retrospective

- [ ] Review success metrics:
  - [ ] Adoption rate (% of agents using registry)
  - [ ] Performance metrics (response times)
  - [ ] Reliability metrics (uptime, error rate)
  - [ ] Developer satisfaction survey
- [ ] Document lessons learned
- [ ] Plan next features (Redis cache, GraphQL, etc.)

## Rollback Plan

### If Deployment Fails

1. **Rollback agent-service:**
   ```bash
   kubectl rollout undo deployment/agent-service
   kubectl rollout status deployment/agent-service
   ```

2. **Rollback wizard-service:**
   ```bash
   kubectl rollout undo deployment/wizard-service
   kubectl rollout status deployment/wizard-service
   ```

3. **Rollback nginx config:**
   ```bash
   kubectl apply -f nginx-routes-backup.yaml
   kubectl exec -it deployment/nginx-ingress -- nginx -s reload
   ```

4. **Verify services:**
   ```bash
   curl https://api.flowgrid.io/health
   curl https://api.flowgrid.io/api/agents
   ```

### If Database Issues

1. **Rollback database migration (if applied):**
   ```bash
   psql $DATABASE_URL -f infrastructure/migrations/rollback_config_jsonb.sql
   ```

2. **Restore from backup (if needed):**
   ```bash
   pg_restore -d flowgrid backup.dump
   ```

## Sign-Off

### Development Team

- [ ] Code reviewed by: _______________
- [ ] Tests reviewed by: _______________
- [ ] Documentation reviewed by: _______________

### Operations Team

- [ ] Deployment plan reviewed by: _______________
- [ ] Monitoring set up by: _______________
- [ ] Rollback plan tested by: _______________

### Product Team

- [ ] Feature acceptance by: _______________
- [ ] Release notes approved by: _______________

### Final Approval

- [ ] Tech Lead: _______________
- [ ] Product Manager: _______________
- [ ] Engineering Manager: _______________

**Deployment Date:** _______________  
**Deployed By:** _______________  
**Status:** _______________ (Success / Partial / Rollback)

---

**Notes:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________
