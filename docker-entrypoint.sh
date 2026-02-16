#!/bin/sh
# SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
#
# SPDX-License-Identifier: Apache-2.0

set -eu

CONFIG_PATH="/app/config.generated.json"

node dist/envToConfig.js "$CONFIG_PATH"
exec node dist/main.js "$CONFIG_PATH"
