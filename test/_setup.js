var assert = require('assert');

const apiToken = process.env.SEVDESK_TOKEN;

before(() => {

    // ensure the token exists
    assert.ok(apiToken, "Missing SEVDESK_TOKEN environment variable to hold the sevDesk API Token");

    // ensure the debug messages are enabled
    if (!process.env.DEBUG || (process.env.DEBUG.indexOf('sevDesk:*') < 0))
        assert.fail("Missing DEBUG environment variable or does not contain 'sevDesk:*'");

});

