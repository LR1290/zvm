'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('R41 contract: paid usage template is unlimited while FREE limits remain separate', () => {
  const paid = section('const USAGE_LIMITS = {', 'const FREE_AUTH_KEY');
  for (const type of ['audio','bulkMessages','document','flow','funnel','media','message','scheduleItem','zapsaver']) {
    assert.match(paid, new RegExp(type + ':[\\s\\S]{0,80}max:-1'));
  }
  const free = section('const FREE_USAGE_LIMITS = {', 'const AUTH_MSG');
  assert.match(free, /message:\s*\{\s*sent:\s*0,\s*max:\s*20\s*\}/);
});

test('R41 contract: non-basic paid records cannot retain finite legacy usageLimits', () => {
  const sanitize = section('function sanitizeKeyRecord(k)', 'function normalizeProUsage');
  assert.match(sanitize, /if \(!k\.isBasicPlan\) \{/);
  assert.match(sanitize, /delete k\.usageLimits;/);
  assert.match(sanitize, /k\.usage\[t\]\.max = -1;/);
});

test('R41 contract: paid usage payload bypasses Basic/FREE normalization', () => {
  const build = section('function buildUsagePayload(keyCode, phone)', 'function incrementUsageRow');
  assert.match(build, /if \(!k\.isBasicPlan\) \{\s*return unlimitedUsagePayload\(k\.usage\);\s*\}/);
});

test('R41 contract: V3 usage and get-usage keep paid records unlimited', () => {
  const usageRoute = section("if (p === R_EXT+'/v3/usage' && req.method === 'POST')", "if (p === R_EXT+'/v3/get-usage' && req.method === 'POST')");
  assert.match(usageRoute, /sanitizeKeyRecord\(keys\[keyCode\]\);/);
  assert.match(usageRoute, /if \(!keys\[keyCode\]\.isBasicPlan\) \{[\s\S]*?unlimitedUsagePayload\(\)/);

  const getUsageRoute = section("if (p === R_EXT+'/v3/get-usage' && req.method === 'POST')", "if (\[R_EXT+'/v3/usage'");
  assert.match(getUsageRoute, /sanitizeKeyRecord\(keys\[keyCode\]\);/);
  assert.match(getUsageRoute, /if \(!keys\[keyCode\]\.isBasicPlan\) \{[\s\S]*?unlimitedUsagePayload\(body\.extensionLimits\)/);
});

test('R41 contract: FREE/Basic remains an explicit branch rather than inferred from PRO plan name', () => {
  const normalize = section('function normalizeProUsage(usage, k)', 'function unlimitedUsagePayload');
  assert.match(normalize, /const isBasic = !!k\?\.isBasicPlan;/);
  assert.doesNotMatch(normalize, /planName|plan_id|planId/);
});


test('R41 contract: check-status reconciles entitlement without adding a new polling endpoint', () => {
  const statusRoute = section("if (p === R_EXT+'/v3/check-status' && req.method === 'POST')", "if (p === R_EXT+'/v3/usage' && req.method === 'POST')");
  assert.match(statusRoute, /isPremium:\s*!_k\.isBasicPlan/);
  assert.match(statusRoute, /isFreePlan:\s*false/);
  assert.match(statusRoute, /isBasicPlan:\s*!!_k\.isBasicPlan/);
  assert.match(statusRoute, /planId:\s*_k\.plan_id \|\| _k\.planId \|\| 'ZV_PRO'/);
  assert.match(statusRoute, /usageAuthority:\s*'server'/);
  assert.match(statusRoute, /isFreeAuthKey\(keyCode\)[\s\S]*?isPremium:\s*false[\s\S]*?isFreePlan:\s*true/);
});

test('R43 contract: server runtime identity advances while preserving R41 entitlement behavior', () => {
  assert.match(source, /const ZVM_BUILD_ID = '2026-10-06-privacy-oauth-release-r43';/);
});
