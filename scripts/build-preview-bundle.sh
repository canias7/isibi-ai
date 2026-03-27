#!/bin/bash
# Build the React SpecPreview bundle and copy to backend/static
# Run from the project root: ./scripts/build-preview-bundle.sh

set -e

echo "Building preview bundle..."
cd frontend
npm run build:preview

echo "Copying bundle to backend/static..."
cp dist-preview/preview-bundle.js ../backend/static/preview-bundle.js

# The CSS file might be named style.css or preview-bundle.css depending on Vite config
if [ -f dist-preview/preview-bundle.css ]; then
  cp dist-preview/preview-bundle.css ../backend/static/preview-bundle.css
elif [ -f dist-preview/style.css ]; then
  cp dist-preview/style.css ../backend/static/preview-bundle.css
else
  echo "WARNING: No CSS file found in dist-preview/"
fi

echo "Done! Bundle files copied to backend/static/"
ls -la ../backend/static/preview-bundle.*
