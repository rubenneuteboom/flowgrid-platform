#!/bin/bash
# Flowgrid Platform - Development Startup Script
# Run this to start all services for local development

set -e

echo "🚀 Starting Flowgrid Platform..."

cd "$(dirname "$0")"

# Check if wizard-service dev server is already running
if lsof -i :3005 > /dev/null 2>&1; then
    echo "✅ Wizard service already running on port 3005 (dev mode)"
else
    echo "📦 Starting wizard service in dev mode..."
    cd services/wizard-service
    npm run dev &
    cd ../..
    sleep 3
fi

# Start infrastructure (postgres, redis, nginx gateway)
echo "🐳 Starting Docker services..."
cd infrastructure
docker compose up -d postgres redis nginx

# Wait for healthy services
echo "⏳ Waiting for services to be healthy..."
docker compose ps

echo ""
echo "✨ Flowgrid Platform is ready!"
echo ""
echo "📍 Access points:"
echo "   • Wizard:    http://localhost:8080/wizard.html"
echo "   • API Docs:  http://localhost:8080/health"
echo "   • Database:  localhost:5432 (user: flowgrid)"
echo ""
echo "🔧 Wizard service running in dev mode on port 3005"
echo "   (nginx proxies /api/wizard/* to it)"
