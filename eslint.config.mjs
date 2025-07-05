// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
	{
		ignores: ['dist'],
	},
	{
		files: ['src/**/*.ts'],
		extends: [eslint.configs.recommended, tseslint.configs.recommended, prettier],
		rules: {
			'@typescript-eslint/naming-convention': [
				'error',
				{
					'selector': ['parameter', 'variable'],
					'leadingUnderscore': 'require',
					'format': ['camelCase'],
					'modifiers': ['unused'],
				},
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					'args': 'all',
					'argsIgnorePattern': '^_',
					'varsIgnorePattern': '^_',
					'caughtErrorsIgnorePattern': '^_',
				},
			],
		},
	},
);
