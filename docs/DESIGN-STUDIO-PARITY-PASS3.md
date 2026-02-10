# FlowGrid Design Studio – Feature Parity Pass 3 (2026-02-10)

## Scope
Pass 3 focused on high-impact advanced workflows and endpoint breadth while keeping tenant/auth controls intact.

Legacy reference: `CIA/web-ui/server.js` + `CIA/web-ui/public/index.html`  
Target: modular platform (`design-module`, `agent-service`, `integration-service`, nginx gateway)

---

## Pass 3 parity progress

### 1) Advanced user-visible workflows
- ✅ **Design bundle export/import workflow** added in Design Studio UI:
  - Header actions: **Export** and **Import**
  - Export downloads tenant-scoped JSON bundle from `GET /api/agents/design/export`
  - Import uploads JSON bundle to `POST /api/agents/design/import`
  - Import reports created/updated counts and refreshes graph/list state
- ✅ **Interaction-focused panel** added in detail view:
  - New **Interactions** tab listing inbound/outbound message contracts per selected agent

### 2) Endpoint parity expansion (critical design workflows)
- ✅ Added tenant-safe legacy parity endpoints in `agent-service`:
  - `GET /api/agent-data-contracts`
  - `GET /api/agent-network-graph`
  - `GET /api/agent-interaction-graph/:agentRef`
  - `GET /api/agents/design/export`
  - `POST /api/agents/design/import`
- ✅ Added gateway route mappings for new top-level endpoints:
  - `/api/agent-data-contracts`
  - `/api/agent-network-graph`
  - `/api/agent-interaction-graph`

### 3) Graph UX states and recovery
- ✅ Added explicit graph overlays for:
  - **loading**
  - **empty** (with recovery guidance)
  - **error** (with retry action)
- ✅ Overlay state transitions integrated with init/refresh and graph rendering paths

### 4) Response shape normalization (where touched)
- ✅ Relationship/interactions loading now normalizes multiple legacy/modular shapes consistently in UI:
  - `sourceId | source_agent_id | sourceAgentId`
  - `targetId | target_agent_id | targetAgentId`
  - `type | message_type | messageType`
- ✅ Deduplication applied when combining `/api/agents/relationships` and `/api/agent-interactions`

### 5) Naming hygiene
- ✅ No legacy CIA naming introduced in runtime UI/code in pass 3 changes.

---

## Files changed

- `services/agent-service/src/index.ts`
- `services/design-module/src/public/index.html`
- `services/design-module/dist/public/index.html`
- `infrastructure/nginx/nginx.conf`
- `infrastructure/nginx/conf.d/routes.conf`
- `docs/DESIGN-STUDIO-PARITY-PASS3.md`

---

## Build/restart + smoke tests run

### Build
- `npm run build` (in `services/agent-service`)
- `npm run build` (in `services/design-module`)

### Rebuild/restart
- `docker compose up -d --build agent-service design-module nginx` (from `infrastructure/`)
- `docker compose restart nginx` (from `infrastructure/`)

### Gateway smoke tests
(Authenticated via dev JWT for demo tenant)
- `GET http://localhost:8080/api/agents/design/export` ✅
- `GET http://localhost:8080/api/agent-network-graph` ✅
- `GET http://localhost:8080/api/agent-interaction-graph/:agentRef` ✅
- `GET http://localhost:8080/api/agent-data-contracts` ✅
- `GET http://localhost:8080/design/` and verify new UI controls/overlays/tabs ✅

---

## Remaining deltas after pass 3

1. **Legacy deep-research/image/BPMN/process-generator families** are still not fully migrated to dedicated modular services.
2. **Deployment workflows** remain partial parity (advanced deploy pipeline and external repo sync hardening still pending).
3. **Advanced modal-heavy wizard/process flows** from legacy UI still require selective migration where product value justifies complexity.
4. **Richer data-contract semantics** are currently derived from interaction config when available; dedicated persisted contract model may be needed for full parity.
