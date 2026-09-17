'use strict';
// Compatibility path for local tests/tools and older maintenance references.
// The runtime owner lives at repository root so browser-based GitHub uploads
// cannot omit a startup-critical module by dropping nested directories.
module.exports = require('../runtime-config');
