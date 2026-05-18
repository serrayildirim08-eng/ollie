/**
 * eslint-plugin-ollie · local ESLint plugin for the ollie monorepo.
 *
 * Currently ships one rule:
 *   ollie/no-banned-copy — voice-library banned-phrase guard. Replaces the
 *   hand-rolled tools/scan-banned-phrases.cjs lexer with an AST rule that
 *   runs the shared rule table in tools/banned-phrases.cjs.
 */

'use strict';

const noBannedCopy = require('./rules/no-banned-copy.cjs');

const plugin = {
  meta: {
    name: 'eslint-plugin-ollie',
    version: '1.0.0',
  },
  rules: {
    'no-banned-copy': noBannedCopy,
  },
};

module.exports = plugin;
