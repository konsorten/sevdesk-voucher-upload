var assert = require('assert');
var path = require('path');
var SevdeskVoucherImporter = require("..");

const apiToken = process.env.SEVDESK_TOKEN;

describe('SevdeskVoucherImporter', function() {

    describe('constructor', function() {

        it('no-token', function() {

            try {
                new SevdeskVoucherImporter();

                assert.fail("Exception expected");
            }
            catch (x) {
                assert.ok(x.message.indexOf("No API token provided") >= 0, `wrong error message: ${x.message}`);
            }

        });

    });

    describe('importLocalFile', function() {

        it('no-file', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.importLocalFile()
            .then(() => { assert.fail("Exception expected"); })
            .catch(x => {
                assert.ok(x.message.indexOf("No file provided") >= 0, `wrong error message: ${x.message}`);
            })
            .then(() => done())
            .catch(done);

        });

        it('non-existent-file', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.importLocalFile(path.join(__dirname, 'examples', 'd0esn0ex1st'))
            .then(() => { assert.fail("Exception expected"); })
            .catch(x => {
                assert.ok(x.message.indexOf("File does not exist") >= 0, `wrong error message: ${x.message}`);
            })
            .then(() => done())
            .catch(done);

        });

        it('invalid-token', function(done) {

            var importer = new SevdeskVoucherImporter('1ll3galt0ken');

            importer.importLocalFile(path.join(__dirname, 'examples', 'R1001.pdf'))
            .then(() => { assert.fail("Exception expected"); })
            .catch(x => {
                assert.ok(x.message.indexOf("Authentication required") >= 0, `wrong error message: ${x.message}`);
            })
            .then(() => done())
            .catch(done);

        });

        it('already-used', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.locked = true; // set to already-used

            importer.importLocalFile(path.join(__dirname, 'examples', 'd0esn0ex1st'))
            .then(() => { assert.fail("Exception expected"); })
            .catch(x => {
                assert.ok(x.message.indexOf("object already used") >= 0, `wrong error message: ${x.message}`);
            })
            .then(() => done())
            .catch(done);

        });
    
        it('upload-file', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.importLocalFile(path.join(__dirname, 'examples', 'R1001.pdf'))
            .then(() => done())
            .catch(done);

        });

    });
});

