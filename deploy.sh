#!/bin/bash
# deploy.sh - Deploy with automatic image cleanup
# Prevents "no space left on device" errors by removing old images

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧹 Cleaning up old container images...${NC}"

# Get list of images sorted by tag (assuming tags are sortable/timestamps)
IMAGES=$(npx wrangler containers images list 2>/dev/null | tail -n +2 | awk '{print $1":"$2}')
IMAGE_COUNT=$(echo "$IMAGES" | wc -l)
KEEP_COUNT=3

if [ "$IMAGE_COUNT" -gt "$KEEP_COUNT" ]; then
    # Calculate how many to delete
    DELETE_COUNT=$((IMAGE_COUNT - KEEP_COUNT))
    echo -e "Found $IMAGE_COUNT images, keeping $KEEP_COUNT most recent, deleting $DELETE_COUNT old ones..."
    
    # Get images to delete (all except last KEEP_COUNT)
    TO_DELETE=$(echo "$IMAGES" | head -n "$DELETE_COUNT")
    
    for img in $TO_DELETE; do
        echo -e "  Deleting ${RED}$img${NC}..."
        npx wrangler containers images delete "$img" 2>/dev/null || echo "  (already deleted or not found)"
    done
    
    echo -e "${GREEN}✅ Cleanup complete${NC}"
else
    echo -e "Only $IMAGE_COUNT images found, no cleanup needed (keeping $KEEP_COUNT)"
fi

echo ""
echo -e "${YELLOW}🚀 Starting deployment...${NC}"
echo ""

# Build first
npm run build

# Deploy
npx wrangler deploy

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
