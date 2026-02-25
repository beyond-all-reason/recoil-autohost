// SPDX-FileCopyrightText: 2026 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

export function engineBinaryName(): string {
	return process.platform === 'win32' ? 'spring-dedicated.exe' : 'spring-dedicated';
}
