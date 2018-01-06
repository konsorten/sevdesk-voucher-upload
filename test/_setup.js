var assert = require('assert');

const apiToken = process.env.SEVDESK_TOKEN;

before(() => {

    assert.ok(apiToken, "Missing SEVDESK_TOKEN environment variable to hold the sevDesk API Token");

});

