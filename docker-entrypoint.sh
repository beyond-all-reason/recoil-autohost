#!/bin/sh
set -eu

CONFIG_PATH="/app/config.generated.json"

node dist/envToConfig.js "$CONFIG_PATH"
exec node dist/main.js "$CONFIG_PATH"
