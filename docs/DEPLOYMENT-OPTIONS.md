# Deployment Options - Explained Simply

## Overview van Alle Opties

```
Local Development (Mac)
    ↓ Test & validate
VPS (€10-50/maand) ← Start hier voor productie!
    ↓ Als je groeit...
Azure Container Apps (€200-400/maand) ← Automatisch schalen
    ↓ Bij enterprise schaal...
Azure Kubernetes (€300-600/maand) ← Max flexibiliteit
```

---

## Option 1: Local Development (FREE)

**Wat:** Docker Compose op je Mac  
**Wanneer:** Development & testing  
**Kosten:** €0  

### Setup
```bash
# Op je Mac
cd ~/Documents/Projects/flowgrid-design-v2
docker-compose up -d
```

### Services draaien op:
- http://localhost:3001 (Agent Service)
- http://localhost:3002 (Auth Service)
- http://localhost:3003 (Design Service)
- http://localhost:8080 (API Gateway)

### ✅ Voordelen
- Gratis
- Snel om te testen
- Geen cloud account nodig
- Direct feedback tijdens development

### ❌ Nadelen
- Alleen beschikbaar als Mac aanstaat
- Niet toegankelijk vanaf internet
- Geen production-ready

### 👉 Gebruik voor:
- Learning microservices
- Testing nieuwe features
- Development workflow

---

## Option 2: VPS (Virtual Private Server)

**Wat:** Linux server in de cloud  
**Wanneer:** Eerste productie deployment  
**Kosten:** €10-50/maand  

### Wat is een VPS?

Een VPS is **jouw eigen Linux server** in de cloud. Denk aan het als:
- Een Mac in de cloud
- Maar dan Linux (Ubuntu/Debian)
- Altijd online (24/7)
- Toegankelijk via internet

### Populaire VPS Providers

| Provider | Specs | Prijs/maand | Use Case |
|----------|-------|-------------|----------|
| **Hetzner Cloud** | 2 CPU, 4GB RAM | €5 | Small (1-10 users) |
| **DigitalOcean** | 2 CPU, 4GB RAM | €24 | Medium (10-50 users) |
| **Hetzner Dedicated** | 8 CPU, 16GB RAM | €30 | Large (50-100 users) |
| **Azure VM B2s** | 2 CPU, 4GB RAM | €35 | Enterprise (compliance) |

### Setup Process

#### Step 1: Create VPS (5 min)
```bash
# Bij Hetzner/DigitalOcean/etc:
1. Sign up
2. Choose: Ubuntu 22.04 LTS
3. Size: 4GB RAM minimum
4. Region: Netherlands/Amsterdam
5. Click "Create"
```

#### Step 2: SSH naar server (1 min)
```bash
# Je krijgt IP adres, bijvoorbeeld 142.93.100.50
ssh root@142.93.100.50

# First time: Accept fingerprint
# Password: Emailed to you
```

#### Step 3: Install Docker (5 min)
```bash
# On the VPS (not your Mac!)
apt-get update
apt-get install -y docker.io docker-compose git
```

#### Step 4: Deploy Flowgrid (5 min)
```bash
# Clone je code
git clone https://github.com/rubenneuteboom/flowgrid-design-studio
cd flowgrid-design-studio

# Create .env file
nano .env
# Add:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# JWT_SECRET=your-secret-here

# Start services (EXACT SAME docker-compose.yml!)
docker-compose up -d

# Check status
docker-compose ps
```

#### Step 5: Point Domain (10 min)
```bash
# Bij je DNS provider (bijvoorbeeld Cloudflare):
A record: api.flowgrid.ai → 142.93.100.50
```

Now accessible at: **http://api.flowgrid.ai:8080**

### ✅ Voordelen VPS
- **Goedkoop** (€10-50/maand all-in)
- **Simpel** (dezelfde docker-compose.yml als lokaal)
- **24/7 online**
- **Internet accessible**
- **Volledige controle**
- **Predictable costs**

### ❌ Nadelen VPS
- Jij moet server beheren (updates, security patches)
- Geen automatic scaling (handmatig nieuwe servers toevoegen)
- Geen automatic failover (als server crashed, manual fix needed)
- Basic monitoring (moet je zelf instellen)

### 🔒 Security Basics (30 min setup)

```bash
# 1. Firewall
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw allow 8080  # API Gateway
ufw enable

# 2. Auto-updates
apt-get install unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades

# 3. Fail2ban (blocks brute force)
apt-get install fail2ban
systemctl enable fail2ban

# 4. SSL Certificate (free via Let's Encrypt)
apt-get install certbot
certbot certonly --standalone -d api.flowgrid.ai
```

### 📊 Monitoring (Optional)

```bash
# Install monitoring stack
docker run -d --name=prometheus -p 9090:9090 prom/prometheus
docker run -d --name=grafana -p 3000:3000 grafana/grafana

# Access at: http://your-ip:3000
```

### 💡 VPS Best Practices

1. **Backups** (daily)
```bash
# Cron job
0 2 * * * docker-compose exec -T postgres pg_dump flowgrid > /backups/db-$(date +\%Y\%m\%d).sql
```

2. **Monitoring disk space**
```bash
df -h  # Check disk usage
```

3. **Update regularly**
```bash
apt-get update && apt-get upgrade
docker-compose pull  # Update Docker images
docker-compose up -d  # Restart with new images
```

### 👉 Gebruik VPS voor:
- First production deployment
- Budget-conscious projects
- 1-100 concurrent users
- Learning server management
- Full control needed

---

## Option 3: Azure Container Apps

**Wat:** Managed container platform  
**Wanneer:** Need automatic scaling  
**Kosten:** €200-400/maand  

### Wat is Azure Container Apps?

**Simpele uitleg:** Azure draait je Docker containers, jij hoeft GEEN servers te beheren.

**Wat Azure doet voor jou:**
- ✅ Automatic scaling (2 → 10 instances bij drukte)
- ✅ Load balancing (built-in)
- ✅ SSL certificates (automatic)
- ✅ Monitoring (Application Insights)
- ✅ Zero-downtime deployments
- ✅ Health checks
- ✅ Security patches (automatic)

### Setup Process

#### Step 1: Create Container Registry (10 min)
```bash
# Create Azure Container Registry (ACR)
az acr create \
  --resource-group rg-flowgrid \
  --name flowgridregistry \
  --sku Basic

# Login
az acr login --name flowgridregistry
```

#### Step 2: Push Images (10 min)
```bash
# Build and tag
docker build -t flowgridregistry.azurecr.io/agent-service:1.0 ./services/agent-service
docker build -t flowgridregistry.azurecr.io/auth-service:1.0 ./services/auth-service

# Push to Azure
docker push flowgridregistry.azurecr.io/agent-service:1.0
docker push flowgridregistry.azurecr.io/auth-service:1.0
```

#### Step 3: Create Container Apps (15 min)
```bash
# Create environment
az containerapp env create \
  --name flowgrid-env \
  --resource-group rg-flowgrid \
  --location westeurope

# Deploy agent-service
az containerapp create \
  --name agent-service \
  --resource-group rg-flowgrid \
  --environment flowgrid-env \
  --image flowgridregistry.azurecr.io/agent-service:1.0 \
  --target-port 3001 \
  --ingress external \
  --min-replicas 2 \
  --max-replicas 10 \
  --cpu 0.5 --memory 1Gi

# Repeat for other services...
```

#### Step 4: Configure Scaling (5 min)
```bash
# Auto-scale based on HTTP traffic
az containerapp update \
  --name agent-service \
  --resource-group rg-flowgrid \
  --scale-rule-name http-scale \
  --scale-rule-type http \
  --scale-rule-http-concurrency 50
```

### ✅ Voordelen Container Apps
- **Zero server management**
- **Automatic scaling** (2 → 10 instances automatisch)
- **Built-in load balancing**
- **Zero-downtime deployments**
- **Automatic SSL**
- **Built-in monitoring**
- **Pay per use** (niet per server)

### ❌ Nadelen Container Apps
- Duurder dan VPS (€200-400 vs €10-50)
- Vendor lock-in (Azure-specific)
- Less control over infrastructure
- Learning curve (Azure concepts)

### 💰 Cost Breakdown (100 tenants)
```
Agent Service: 3 instances × €50 = €150
Auth Service: 2 instances × €50 = €100
Design Service: 2 instances × €50 = €100
Networking: €20
Monitoring: €30
Total: €400/maand
```

### 👉 Gebruik Container Apps voor:
- Need automatic scaling
- 100-1000 concurrent users
- Don't want to manage servers
- Enterprise production
- Budget allows €200-400/maand

---

## Option 4: Azure Kubernetes Service (AKS)

**Wat:** Full Kubernetes cluster  
**Wanneer:** Enterprise scale, max flexibility  
**Kosten:** €300-600/maand  

### Wat is Kubernetes?

**Simpele uitleg:** Kubernetes = orchestration platform voor containers

**Denk aan Kubernetes als:**
- Docker Compose on steroids
- Manages 100s of containers
- Automatic failover
- Rolling updates
- Self-healing

### Wanneer je Kubernetes NODIG hebt:
- 1000+ concurrent users
- Complex microservices (10+ services)
- Multi-region deployment
- Strict SLAs (99.99% uptime)
- Advanced networking needs

### ✅ Voordelen Kubernetes
- **Maximum flexibility**
- **Industry standard** (niet vendor-locked)
- **Advanced features** (service mesh, sidecars, etc.)
- **Strong ecosystem** (Helm, Operators, etc.)
- **Multi-cloud** (werkt op Azure, AWS, GCP)

### ❌ Nadelen Kubernetes
- **Complex** (steile leercurve)
- **Duurder** (€300-600/maand)
- **Overkill** voor <1000 users
- **Requires expertise** (DevOps skills)

### 👉 Gebruik Kubernetes voor:
- Enterprise scale (1000+ users)
- Complex architectures
- Multi-region
- When you NEED the flexibility
- Team has K8s expertise

---

## Decision Tree

```
START HERE
    ↓
Are you learning/testing?
    Yes → LOCAL (Docker Compose on Mac)
    No ↓
    
Do you have <100 users?
    Yes → VPS (€10-50/maand)
    No ↓
    
Need automatic scaling?
    No → VPS with Load Balancer (€50-100/maand)
    Yes ↓
    
Budget <€300/maand?
    Yes → Azure Container Apps (€200-400/maand)
    No ↓
    
Need max flexibility?
    Yes → Kubernetes (€300-600/maand)
    No → Container Apps is probably enough
```

---

## Recommended Path for Flowgrid

### Phase 1: NOW (This Week)
**Setup:** Local Docker Compose  
**Purpose:** Learn, test, validate  
**Cost:** €0  
**Time:** 2-3 hours  

```bash
cd ~/Documents/Projects/flowgrid-design-v2
# Follow MICROSERVICES-QUICKSTART.md
docker-compose up -d
```

---

### Phase 2: First Production (Next Month)
**Setup:** Hetzner VPS (€10-30/maand)  
**Purpose:** First real users, beta testers  
**Users:** 1-50  
**Time:** 1 day setup  

**Why VPS first:**
- ✅ Cheapest option
- ✅ Learn without big commitment
- ✅ Easy to migrate later
- ✅ Exact same docker-compose.yml

```bash
# On Hetzner VPS
git clone https://github.com/...
docker-compose up -d
# Done!
```

---

### Phase 3: Scale Up (6 months)
**Setup:** Azure Container Apps  
**Purpose:** 50-500 users, automatic scaling  
**Cost:** €200-400/maand  

**Why upgrade:**
- Need automatic scaling
- Want zero-downtime deployments
- Don't want to manage servers
- Professional production setup

---

### Phase 4: Enterprise (1+ year)
**Setup:** Consider Kubernetes  
**Purpose:** 500+ users, complex needs  
**Cost:** €300-600/maand  

**Why Kubernetes:**
- Multi-region deployment
- Service mesh needed
- Advanced networking
- 99.99% SLA requirements

---

## My Recommendation for YOU

### This Week: Local Development
```bash
cd ~/Documents/Projects/flowgrid-design-v2
# Follow MICROSERVICES-QUICKSTART.md
docker-compose up -d
# Proof of concept in 2-3 hours!
```

### Next Month: Deploy to VPS
```bash
# Create Hetzner server (€10/maand)
ssh root@your-vps
git clone https://github.com/rubenneuteboom/flowgrid-design-studio
docker-compose up -d
# Production ready!
```

**Why this order:**
1. **Local first** = learn without cost
2. **VPS second** = cheapest real production
3. **Later upgrade** = when you actually need it

**Don't start with Kubernetes!** That's like buying a Formula 1 car to learn driving. Start simple, upgrade when needed.

---

## FAQ

### Q: Can I run Docker Compose in production?
**A:** Yes! Many companies do. VPS + Docker Compose = valid production setup for <100 users.

### Q: When should I move from VPS to Container Apps?
**A:** When:
- You have >50 concurrent users
- Manual scaling becomes annoying
- You need automatic failover
- Budget allows €200-400/maand

### Q: Is VPS secure enough?
**A:** Yes, if you:
- Enable firewall (ufw)
- Use SSH keys (not passwords)
- Keep system updated
- Use SSL certificates

### Q: Can I migrate easily from VPS to Container Apps?
**A:** Yes! Same Docker images work everywhere:
```
VPS: docker-compose up -d
Container Apps: az containerapp create --image ...
Kubernetes: kubectl apply -f ...
```

### Q: What's the cheapest production option?
**A:** VPS at Hetzner: €5-10/maand for 4GB RAM server. More than enough to start!

---

## Cost Comparison (Real Numbers)

| Setup | 10 users | 50 users | 100 users | 500 users |
|-------|----------|----------|-----------|-----------|
| **VPS (Hetzner)** | €10 | €20 | €30 | €100 |
| **VPS (DigitalOcean)** | €24 | €48 | €96 | €200 |
| **Container Apps** | €200 | €250 | €350 | €600 |
| **Kubernetes** | €300 | €350 | €450 | €800 |

**Clear winner voor <100 users:** VPS! 🏆

---

## Next Steps

1. **This week:** Setup local Docker Compose (MICROSERVICES-QUICKSTART.md)
2. **Test locally:** Validate microservices work
3. **Next month:** Create Hetzner VPS (€10/maand)
4. **Deploy:** Same docker-compose.yml to VPS
5. **Monitor:** Use for 3-6 months
6. **Upgrade:** When you hit 50-100 users

**Don't overthink it!** Start local → VPS → upgrade when needed.

---

**Questions?** Let me know on Telegram! 📱
