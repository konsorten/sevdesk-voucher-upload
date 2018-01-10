var assert = require('assert');
var path = require('path');
var fs = require('fs-extra');
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

        it('api-token-visibility', function() {

            var importer = new SevdeskVoucherImporter(apiToken);

            assert.ok(Object.values(importer).indexOf(apiToken) < 0, 'API token was found in object');

        });

    });

    describe('loadContacts', function() {

        it('load-uncached', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.loadAllContacts()
            .then(() => assert.ok(!importer.allContactsFromCache, "contacts already cached"))
            .then(() => done())
            .catch(done);

        });

        it('load-cached', function(done) {

            var importer = new SevdeskVoucherImporter(apiToken);

            importer.loadAllContacts()
            .then(() => assert.ok(importer.allContactsFromCache, "contacts not cached"))
            .then(() => done())
            .catch(done);

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
            .then(() => {
                assert.ok(typeof importer.newDocumentId === 'number', "missing new document id");
                assert.ok(importer.newDocumentId > 0, "invalid new document id");

                done();
            })
            .catch(done);

        });
            
    });

    describe('importBuffer', function() {

        it('invalid-token', function(done) {

            var importer = new SevdeskVoucherImporter('1ll3galt0ken');

            var content = fs.readFileSync(path.join(__dirname, 'examples', 'R1001.pdf'));
            
            importer.importBuffer(content, 'R1001.pdf')
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

            var content = fs.readFileSync(path.join(__dirname, 'examples', 'R1001.pdf'));

            importer.importBuffer(content, 'R1001.pdf')
            .then(() => { assert.fail("Exception expected"); })
            .catch(x => {
                assert.ok(x.message.indexOf("object already used") >= 0, `wrong error message: ${x.message}`);
            })
            .then(() => done())
            .catch(done);

        });
    
        it('upload-buffer', function(done) {
            
            var importer = new SevdeskVoucherImporter(apiToken);

            var content = fs.readFileSync(path.join(__dirname, 'examples', 'R1001.pdf'));

            importer.importBuffer(content, 'R1001.pdf')
            .then(() => {
                assert.ok(typeof importer.newDocumentId === 'number', "missing new document id");
                assert.ok(importer.newDocumentId > 0, "invalid new document id");

                done();
            })
            .catch(done);

        });
            
    });
});

