var fs = require('fs-extra-promise');
var request = require('request-promise-native');
var uuid = require('uuid');
var path = require('path');
var moment = require('moment');
var mime = require('mime/lite');
var debugMod = require('debug');

class SevdeskVoucherImporter {

    /**
     * @param {string} filePath Path to the local file to be imported.
     * @returns {void}
     */
    async importLocalFile(filePath) {
        // lock the object
        if (this.locked)
            throw new Error("SevdeskVoucherImporter object already used; the object cannot be reused");
        
        this.locked = true;

        // prepare
        this.cft = uuid.v4().replace(/-/g, '');
        this.debug = debugMod(`sevDesk:voucherImporter:${this.cft}`);

        // check the file
        this.debug(`Checking file: ${filePath} ...`);

        if (!filePath)
            throw new Error("No file provided; missing parameter 'filePath'");

        if (!(await fs.existsAsync(filePath)))
            throw new Error(`File does not exist: ${filePath}`);

        if (!(await fs.statAsync(filePath)).isFile())
            throw new Error(`Path exists but is not a file: ${filePath}`);

        // upload the file
        this.debug(`Uploading file: ${filePath} ...`);

        let res = await request({
            method: 'POST',
            uri: `${this.baseUrl}/Voucher/Factory/uploadTempFile`,
            qs: {
                cft: this.cft,
                token: this.apiToken,
            },
            formData: {
                file: {
                    value: fs.createReadStream(filePath),
                    options: {
                        filename: path.basename(filePath),
                        contentType: mime.getType(path.extname(filePath)),
                    }
                }
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });

        // retrieve the filename
        if (!res.objects || !res.objects.filename)
            throw new Error(`Failed to extract filename from response: ${JSON.stringify(res)}`);

        let remoteFilename = res.objects.filename;

        this.debug(`Successfully uploaded as ${remoteFilename}`);

        // extract information
        this.debug("Extracting information...");

        res = await request({
            method: 'GET',
            uri: `${this.baseUrl}/Voucher/Factory/extractThumb`,
            qs: {
                cft: this.cft,
                token: this.apiToken,
                fileName: remoteFilename,
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });

        if (!res.objects || !Array.isArray(res.objects.extractions))
            throw new Error(`Failed to extract information from response: ${JSON.stringify(res)}`);

        let resultDisdar = res; // save for later

        // transform the information
        let extractions = {};
        
        for (let ex of res.objects.extractions) {
            if (!Array.isArray(ex.labels)) continue;

            for (let l of ex.labels) {
                if (!extractions[l.type] || (extractions[l.type].confidence < l.confidence))
                    extractions[l.type] = { ...l, type: undefined };
            }
        }

        this.debug(`Successfully Extracted information: ${Object.keys(extractions).map(k => `${k}="${extractions[k].value}"`).join(", ")}`);

        // determine issuer contact
        // (highest priority is checked first)
        this.issuerContacts = [];

        if (extractions.CREDITORNAME) {
            // try to find the exact name
            await this.findContactByName(extractions.CREDITORNAME.value);

            // try to find by first word
            let nameParts = extractions.CREDITORNAME.value.split(' ', 2);

            if (nameParts.length >= 2) // only do this if there are at least two words
                await this.findContactByName(nameParts[0]);
        
        } else {
            this.debug("Skipping resolving issuer contact by name; name is not known");
        }

        // save the voucher
        this.debug("Saving voucher...");

        let formData = {
            'voucher[voucherDate]': (extractions.INVOICEDATE ? extractions.INVOICEDATE.value : moment().format('YYYY-MM-DD')),
            'voucher[description]': (extractions.INVOICENUMBER ? extractions.INVOICENUMBER.value : ""),
            'voucher[resultDisdar]': JSON.stringify(resultDisdar),
            'voucher[status]': '50' /* draft */,
            'voucher[taxType]': 'default',
            'voucher[creditDebit]': 'C',
            'voucher[voucherType]': 'VOU',
            'voucher[iban]:': (extractions.IBAN ? extractions.IBAN.value : "null"),
            'voucher[tip]': '0',
            'voucher[mileageRate]': '0',
            'voucher[selectedForPaymentFile]': '0',
            'voucher[objectName]': 'Voucher',
            'voucher[mapAll]': 'true',
            'voucherPosSave[0][taxRate]': (extractions.TAXRATE ? extractions.TAXRATE.value : 19).toString(),
            'voucherPosSave[0][sum]': (extractions.NETAMOUNT ? Number.parseInt(extractions.NETAMOUNT.value) / 100 : 0).toString(),
            'voucherPosSave[0][objectName]': 'VoucherPos',
            'voucherPosSave[0][mapAll]': 'true',
            'filename': remoteFilename,
            'existenceCheck': 'true',
        };

        // inject issuer/creditor
        if (this.issuerContacts.length > 0) {
            formData = { 
                ...formData, 
                'voucher[supplier][id]': this.issuerContacts[0].id,
                'voucher[supplier][objectName]': 'Contact',
            };
        } else {
            formData = { 
                ...formData, 
                'voucher[supplierName]': (extractions.CREDITORNAME ? extractions.CREDITORNAME.value : "???"),
            };
        }
request.debug = true;
        // perform save
        res = await request({
            method: 'POST',
            uri: `${this.baseUrl}/Voucher/Factory/saveVoucher`,
            qs: {
                cft: this.cft,
                token: this.apiToken,
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            form: formData,
            json: true,
            gzip: true,
        });

        if (!res.objects || !res.objects.document || !res.objects.document.id)
            throw new Error(`Failed to extract document from response: ${JSON.stringify(res)}`);

        this.debug(`Successfully saved voucher: ${res.objects.document.id}`);
    }

    async findContactByName(name) {
        this.debug(`Resolving issuer contact by name: ${name} ...`);

        let res = await request({
            method: 'GET',
            uri: `${this.baseUrl}/Contact`,
            qs: {
                cft: this.cft,
                token: this.apiToken,
                depth: true,
                name: name,
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });

        if (!Array.isArray(res.objects))
            throw new Error(`Failed to get contacts from response: ${JSON.stringify(res)}`);

        if (res.objects.length <= 0) {
            this.debug(`No issuer contact was found by name: ${name}`);
        } else {
            for (let c of res.objects) {
                this.debug(`Found issuer contact by name: ${c.name} (#${c.id})`);

                this.issuerContacts.push(c);
            }
        }
    }

    /**
     * @param {string} apiToken The sevDesk API Token
     */
    constructor(apiToken) {
        if (!apiToken)
            throw new Error("No API token provided; missing parameter 'apiToken'");

        this.apiToken = apiToken;
        this.baseUrl = "https://my.sevdesk.de/api/v1";
        this.locked = false;
    }
}


module.exports = SevdeskVoucherImporter;
