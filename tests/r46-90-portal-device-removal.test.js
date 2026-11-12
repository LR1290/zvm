'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const viewStart = server.indexOf('function renderStandalonePortalDashboard(');
const viewEnd = server.indexOf('\nfunction renderStandalonePortalPlans(', viewStart);
const routeStart = server.indexOf("  if (p === '/cliente/dispositivos/remover' && req.method === 'POST') {");
const routeEnd = server.indexOf("\n  if (p === '/cliente/email')", routeStart);
assert(viewStart > 0 && viewEnd > viewStart && routeStart > 0 && routeEnd > routeStart);
const view = server.slice(viewStart, viewEnd);
const route = server.slice(routeStart, routeEnd);
let passes = 0;

assert.match(view, /name="keyCode" value="\$\{escHtml\(keyData\.code\|\|''\)\}"/);
assert.match(view, /name="phone" value="\$\{escHtml\(phone\)\}"/);
assert.doesNotMatch(view, /name="index"/);
passes++;

assert.match(route, /isPortalSession\(req\)/);
assert.match(route, /requireSameOriginPost\(req\)/);
assert.match(route, /form\.get\('phone'\)/);
assert.match(route, /form\.get\('keyCode'\)/);
assert.match(route, /user\.keyCode !== requestedKeyCode/);
assert.match(route, /readAdminKeySnapshot\(user\.keyCode, \{ db \}\)/);
assert.match(route, /draft\.phones\.includes\(phone\)/);
assert.match(route, /removePhoneFromKey\(draft, phone\)/);
assert.doesNotMatch(route, /Number\(indexRaw\)|snapshot\.phones\[Number/);
passes++;

assert.match(route, /Location: '\/cliente\?device=refresh'/);
assert.match(route, /Location: '\/cliente\?device=changed'/);
assert.match(route, /Location: '\/cliente\?ok=1'/);
assert.doesNotMatch(route, /sendJson\(res, \{ error: 'device_changed'/);
assert.match(server, /_deviceFailure === 'changed'/);
assert.match(server, /deviceMsg \? `<div class="device-warning" role="alert">/);
passes++;

const selectorStart = route.indexOf('      const phone = Array.isArray(snapshot.phones)');
const selectorEnd = route.indexOf('\n      if (!phone)', selectorStart);
assert(selectorStart >= 0 && selectorEnd > selectorStart);
const selectPhone = new Function('snapshot', 'requestedPhone', route.slice(selectorStart, selectorEnd) + '\nreturn phone;');
const displayed = ['551100000001', '551100000002'];
const reordered = { phones: ['551100000003', '551100000001', '551100000002'] };
assert.equal(selectPhone(reordered, displayed[1]), '551100000002', 'reordering cannot target another phone');
assert.equal(selectPhone({ phones: ['551100000003', '551100000001'] }, displayed[1]), null, 'removed phone must not target successor');
assert.equal(selectPhone({ phones: [] }, displayed[1]), null);
assert.equal(selectPhone({ phones: ['551100000001'] }, '551100000002'), null);
assert.equal(selectPhone({ phones: ['551100000001'] }, '551100000001'), '551100000001');
passes++;

console.log('R46.90 PASS: ' + passes + ' portal device identity/security regression groups');
