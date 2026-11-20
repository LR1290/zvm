'use strict';
// Refuse to start the backend if the QA environment is misconfigured.
const {checkQaEnvironment}=require('./preflight-qa.cjs');
try {
  checkQaEnvironment(process.env);
} catch (error) {
  process.stderr.write('QA_START_BLOCKED: ' + (error.code || 'PREFLIGHT_FAILED') + '\n');
  process.exit(1);
}
require('../../server.js');
