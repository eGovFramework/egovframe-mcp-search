#!/bin/bash

SRC_DIR="$(cd "$(dirname "$0")" && pwd)/docs"
DEST_DIR="/Users/chrisyoon/Notebooks/1-Projects/260504-mcp-dev/docs"

mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/* "$DEST_DIR"/

echo "Copied docs to $DEST_DIR"
