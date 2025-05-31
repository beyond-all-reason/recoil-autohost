// SPDX-FileCopyrightText: 2025 The Recoil Autohost Authors
//
// SPDX-License-Identifier: Apache-2.0

import { type Logger } from 'pino';

/**
 * Environment is a uniform object to be passed within the application that
 * contains all global services and objects that need to be injected across
 * the application.
 *
 * The goal is to make all the objects within application accepts the same
 * type of configuration interface, easily mock them in tests, and allow
 * to extend with more objects like this.
 *
 * Good candidates to elements in Environment are global singletons that have
 * global nature and lifetime like logger, metrics, configuration etc.
 */
export interface Environment<Config extends object = object, Mocks extends object = object> {
	logger: Logger;
	config: Config;
	mocks?: Mocks;
}
