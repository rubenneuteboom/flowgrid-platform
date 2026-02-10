# FlowGrid Design Studio – Feature Parity Pass 2 (2026-02-10)

## Scope
Legacy reference: `CIA/web-ui/server.js` + `CIA/web-ui/public/index.html`  
Target: modular platform (`design-module`, `agent-service`, `design-service`, `integration-service`, nginx)

---

## Parity Matrix (Pass 2)

### UI capabilities
| Legacy capability | Target module | Pass 2 status | Notes |
|---|---|---:|---|
| Graph render + node select/focus | design-module | ✅ | Existing vis-network behavior retained. |
| Search + type filter list | design-module | ✅ | Existing behavior retained. |
| Detail tabs (overview/objectives/integrations/relations/code) | design-module | ✅ | Existing behavior retained. |
| Save/delete agent actions | design-module + agent-service | ✅ | Existing behavior retained. |
| Add integration action | design-module + integration-service | ✅ | Hooked to catalog + per-agent integration save endpoint. |
| Generate code action | design-module + design-service | ✅ | Hooked to `/api/design/generate-code/:agentId`. |
| Quick create agent action | design-module + agent-service | ✅ | Added “New Agent” header action. |
| Refresh action | design-module | ✅ | Added explicit refresh action for loading/error recovery. |
| Error/empty/loading states | design-module | 🟡 | Good baseline (list + notifications); graph-level advanced placeholders remain limited. |

### Backend/API capabilities
| Legacy endpoint/capability family | Target service | Pass 2 status | Notes |
|---|---|---:|---|
| `/api/agents*` CRUD | agent-service | ✅ | Already present with tenant scoping. |
| `/api/agents/relationships` | agent-service | ✅ | Existing endpoint retained. |
| Legacy-style `/api/relationships` | agent-service + nginx | ✅ | Added endpoint + gateway route mapping. |
| Legacy-style `/api/agent-interactions` | agent-service + nginx | ✅ | Added endpoint + gateway route mapping. |
| `/api/integrations/catalog` | integration-service | ✅ | Existing endpoint retained, now auth-protected. |
| Per-agent integration status/config | integration-service | ✅ | Existing endpoints retained, now tenant ownership checked. |
| Design patterns/analyze/refine/generate-code/chat | design-service | ✅ | Existing endpoints retained, token parity fixed in compose env. |
| Deployment-related stubs | mixed | 🟡 | No new deployment endpoint migration in this pass. |
| Deep-research/image/BPMN/process generator legacy families | mixed | ⏳ | Deferred (pass 3 backlog). |

---

## Pass 2 implementation highlights
- Added **legacy parity routes** in `agent-service` for:
  - `GET/POST /api/relationships`
  - `GET /api/agent-interactions`
  - `GET /api/agents/:id/integrations`
- Added **tenant-safe auth enforcement** in `integration-service`:
  - JWT auth middleware for `/api/*`
  - tenant ownership checks before reading/updating agent integration data
- Connected design-module UI actions to real modular APIs:
  - Add integration (catalog + assign)
  - Generate code (design-service)
  - New agent + refresh actions
- Updated gateway routing:
  - `/api/relationships` → agent-service
  - `/api/agent-interactions` → agent-service
- Fixed compose runtime token parity:
  - Added `JWT_SECRET` env to `design-service` and `integration-service`

---

## Remaining gaps for Pass 3
1. Legacy monolith endpoint breadth still larger (process/BPMN/deep-research/image-analysis/import/export/deploy workflows).
2. UI parity still short on advanced legacy panels and workflow-heavy modals.
3. Add stronger graph empty/loading/error overlays and retry UX beyond notifications.
4. Evaluate splitting remaining legacy routes across dedicated modular services instead of expanding current service surfaces.
