var fs = require('fs-extra-promise');
var request = require('request-promise-native');
var uuid = require('uuid');
var path = require('path');
var moment = require('moment');
var mime = require('mime/lite');
var debugMod = require('debug');
var createLRU = require("lru-cache");

var __cache = createLRU({ maxAge: 1000 * 60 * 60 * 15 /* 15 minutes */ });
var __apiTokenVar = Symbol();

/**
 * The main voucher importer class.
 */
class SevdeskVoucherImporter {

    /** 
     * Imports a single local file. The file is most likely a PDF or image file.
     * 
     * @param {string} filePath Path to the local file to be imported.
     * @returns {Promise<void>} An empty promise is returned.
     * @throws {Error} An error happened during the import. Inner exceptions are not being wrapped.
     */
    async importLocalFile(filePath) {
        // lock the object
        if (this.locked)
            throw new Error("SevdeskVoucherImporter object already used; the object cannot be reused");
        
        this.locked = true;

        // check the file
        this.debug(`Checking file: ${filePath} ...`);

        if (!filePath)
            throw new Error("No file provided; missing parameter 'filePath'");

        if (!(await fs.existsAsync(filePath)))
            throw new Error(`File does not exist: ${filePath}`);

        if (!(await fs.statAsync(filePath)).isFile())
            throw new Error(`Path exists but is not a file: ${filePath}`);

        // load client information
        await this.loadClientInfo();

        // upload the file
        this.debug(`Uploading file: ${filePath} ...`);

        let res = await request({
            method: 'POST',
            uri: `${this.baseUrl}/Voucher/Factory/uploadTempFile`,
            qs: {
                cft: this.cft,
                token: this[__apiTokenVar],
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
                token: this[__apiTokenVar],
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

        // load all contacts for extended resolution
        await this.loadAllContacts();

        // determine issuer contact
        // (highest priority is checked first)
        this.issuerContacts = [];

        // try to find the exact name
        if (extractions.CREDITORNAME) {
            await this.findContactByName(extractions.CREDITORNAME.value);        
        } else {
            this.debug("Skipping resolving issuer contact by exact name; name is not known");
        }

        // try to find the bank account
        if (extractions.IBAN) {
            await this.findContactByBankAccount(extractions.IBAN.value);        
        } else {
            this.debug("Skipping resolving issuer contact by bank account; IBAN is not known");
        }

        // try to find by first word
        if (extractions.CREDITORNAME) {
            let nameParts = extractions.CREDITORNAME.value.split(' ', 2);

            if (nameParts.length >= 2) // only do this if there are at least two words
                await this.findContactByName(nameParts[0]);
        
        } else {
            this.debug("Skipping resolving issuer contact by first word of name; name is not known");
        }

        // estimate the accounting type
        let accountingType = null;

        if (this.issuerContacts.length > 0) {
            accountingType = await this.estimateAccountingType(this.issuerContacts[0], extractions);
        }

        // save the voucher
        this.debug("Saving voucher...");

        let formData = {
            'voucher[voucherDate]': String(extractions.INVOICEDATE ? extractions.INVOICEDATE.value : moment().format('YYYY-MM-DD')),
            'voucher[description]': String(extractions.INVOICENUMBER ? extractions.INVOICENUMBER.value : null),
            'voucher[resultDisdar]': JSON.stringify(resultDisdar),
            'voucher[status]': '50' /* draft */,
            'voucher[taxType]': 'default',
            'voucher[creditDebit]': 'C',
            'voucher[voucherType]': 'VOU',
            'voucher[iban]:': String(extractions.IBAN ? extractions.IBAN.value : null),
            'voucher[tip]': '0',
            'voucher[mileageRate]': '0',
            'voucher[selectedForPaymentFile]': '0',
            'voucher[objectName]': 'Voucher',
            'voucher[mapAll]': 'true',
            'voucherPosSave[0][taxRate]': String(extractions.TAXRATE ? extractions.TAXRATE.value : null),
            'voucherPosSave[0][sum]': String(extractions.NETAMOUNT ? Number.parseInt(extractions.NETAMOUNT.value) / 100 : 0),
            'voucherPosSave[0][objectName]': 'VoucherPos',
            'voucherPosSave[0][mapAll]': 'true',
            'filename': String(remoteFilename),
            'existenceCheck': 'true',
        };

        // inject issuer/creditor
        if (this.issuerContacts.length > 0) {
            formData = { 
                ...formData, 
                'voucher[supplier][id]': String(this.issuerContacts[0].id),
                'voucher[supplier][objectName]': 'Contact',
                'voucher[supplierMethod]': String(this.issuerContacts[0].method),
            };
        } else {
            formData = { 
                ...formData, 
                'voucher[supplierName]': String(extractions.CREDITORNAME ? extractions.CREDITORNAME.value : "???"),
            };
        }

        // inject accounting type
        if (accountingType) {
            formData = { 
                ...formData, 
                'voucherPosSave[0][accountingType][id]': String(accountingType),
                'voucherPosSave[0][accountingType][objectName]': 'AccountingType',
                'voucherPosSave[0][estimatedAccountingType][id]': String(accountingType),
                'voucherPosSave[0][estimatedAccountingType][objectName]': 'AccountingType',
            };
        }

        // perform save
        res = await request({
            method: 'POST',
            uri: `${this.baseUrl}/Voucher/Factory/saveVoucher`,
            qs: {
                cft: this.cft,
                token: this[__apiTokenVar],
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

    async findContactByBankAccount(bankAccount) {
        // prepare
        bankAccount = bankAccount.replace(/[\t -]/g, '');

        this.debug(`Resolving issuer contact by bank account: ${bankAccount} ...`);

        // is this the clients' bank account?
        if (this.clientInfo.bankIban && bankAccount.match(new RegExp(`^${this.clientInfo.bankIban}$`, 'i'))) {
            this.debug(`Ignoring bank account because it belong to the client: ${bankAccount}`);
            return;
        }

        // look for exact match
        let found = this.allContacts.filter(o => o.bankAccount && o.bankAccount.replace(/[\t -]/g, '').match(new RegExp(`^${bankAccount}$`, 'i')));

        if (found.length <= 0) {
            this.debug(`No issuer contact was found by bank account: ${bankAccount}`);
        } else {
            for (let c of found) {
                this.debug(`Found issuer contact by bank account: ${c.name} (#${c.id})`);

                this.issuerContacts.push({ ...c, method: "bankAccountExact" });
            }
        }
    }

    async findContactByName(name) {
        this.debug(`Resolving issuer contact by name: ${name} ...`);

        // is this the clients' name?
        if (this.clientInfo.name && name.match(new RegExp(`^${this.clientInfo.name}$`, 'i'))) {
            this.debug(`Ignoring contact because it belongs to the client: ${name}`);
            return;
        }

        // look for exact name match
        let found = this.allContacts.filter(o => o.name && o.name.match(new RegExp(`^${name}$`, 'i')));

        if (found.length <= 0) {
            this.debug(`No issuer contact was found by exact name: ${name}`);
        } else {
            for (let c of found) {
                this.debug(`Found issuer contact by exact name: ${c.name} (#${c.id})`);

                this.issuerContacts.push({ ...c, method: "nameExact" });
            }
        }

        // look for partial name match
        found = this.allContacts.filter(o => o.name && o.name.match(new RegExp(`${name}`, 'i')));

        if (found.length <= 0) {
            this.debug(`No issuer contact was found by partial name: ${name}`);
        } else {
            for (let c of found) {
                this.debug(`Found issuer contact by partial name: ${c.name} (#${c.id})`);

                this.issuerContacts.push({ ...c, method: "namePartial" });
            }
        }

        // look for partial name2 match
        found = this.allContacts.filter(o => o.name2 && o.name2.match(new RegExp(`${name}`, 'i')));

        if (found.length <= 0) {
            this.debug(`No issuer contact was found by partial name2: ${name}`);
        } else {
            for (let c of found) {
                this.debug(`Found issuer contact by partial name2: ${c.name} (#${c.id})`);

                this.issuerContacts.push({ ...c, method: "name2Partial" });
            }
        }
    }

    async loadAllContacts() {
        // already loaded? 
        if (Array.isArray(this.allContacts)) 
            return;

        await this.loadClientInfo();

        this.debug(`Loading all contacts...`);

        // cached?
        let cached = __cache.get(`${this.clientInfo.id}:allContacts`);

        if (cached) {
            this.allContacts = cached;
            this.allContactsFromCache = true;
            
            this.debug(`Successfully retrieved ${this.allContacts.length} contacts from cache`);
            return;
        }

        // prepare
        this.allContacts = [];
        this.allContactsFromCache = false;

        let res = null;
        let offset = 0;

        do {
            // load a bunch of contacts
            res = await request({
                method: 'GET',
                uri: `${this.baseUrl}/Contact`,
                qs: {
                    cft: this.cft,
                    token: this[__apiTokenVar],
                    depth: true,
                    limit: 100,
                    offset: offset,
                    'orderBy[0][field]': 'create',  // 'id' field does not work
                    'orderBy[0][arrangement]': 'asc',
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

            offset += res.objects.length;
    
            this.allContacts = this.allContacts.concat(res.objects);
    
        } while (res.objects.length > 0);
    
        this.debug(`Successfully loaded ${this.allContacts.length} contacts`);

        __cache.set(`${this.clientInfo.id}:allContacts`, this.allContacts);

        //this.debug(JSON.stringify(this.allContacts[0]));
    }

    async loadClientInfo() {
        // already loaded? 
        if (this.clientInfo) 
            return;

        this.debug(`Loading client information...`);

        let res = await request({
            method: 'GET',
            uri: `${this.baseUrl}/SevClient`,
            qs: {
                cft: this.cft,
                token: this[__apiTokenVar],
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });

        if (!Array.isArray(res.objects) || (res.objects.length < 1))
            throw new Error(`Failed to get client information from response: ${JSON.stringify(res)}`);

        this.clientInfo = res.objects[0];

        this.debug(`Client ID: ${this.clientInfo.id}`);

        //this.debug(JSON.stringify(this.clientInfo));
    }

    async estimateAccountingType(contact, extractions) {
        if (!contact)
            throw new Error("no contact provided; missing parameter 'contact'");

        if (!extractions)
            throw new Error("no extracted information provided; missing parameter 'extractions'");

        await this.loadClientInfo();

        let contactAddress = await this.loadContactAddress(contact.id);

        this.debug(`Estimating accounting type for contact ${contact.name} (#${contact.id})...`);

        let res = await request({
            method: 'GET',
            uri: `${this.baseUrl}/AccountingIndex/Query/estimateType`,
            qs: {
                cft: this.cft,
                token: this[__apiTokenVar],
                jsonData: JSON.stringify({
                    sev_client: this.clientInfo.id,
                    credit_debit: 'C',
                    industry: null,
                    address_country: this.clientInfo.addressCountry.id,
                    form_of_company: this.clientInfo.formOfCompany,
                    company_size: null,
                    small_settlement: false,
                    sum_net: (extractions.NETAMOUNT ? parseInt(extractions.NETAMOUNT.value) : null),
                    sum_tax: (extractions.TAXRATE ? parseInt(extractions.TAXRATE.value) : null),
                    supplier: contact.id,
                    supplier_name: contact.name,
                    supplier_country: (contactAddress ? contactAddress.country.id : null),
                    id_accounting_type: null,
                }),
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });

        if (!res.objects)
            throw new Error(`Failed to get estimated accounting type from response: ${JSON.stringify(res)}`);

        // handle the result
        if (Object.keys(res.objects).indexOf(this.clientInfo.chartOfAccounts) > 0) {
            let code = res.objects[this.clientInfo.chartOfAccounts];

            this.debug(`Estimated accounting type: ${this.clientInfo.chartOfAccounts} ${code} - ${res.objects.name} (#${res.objects.id})`);
        } else {
            this.debug(`Estimated accounting type: ${res.objects.name} (#${res.objects.id})`);
        }

        //this.debug(JSON.stringify(res.objects));

        return res.objects.id;
    }

    async loadContactAddress(contactId) {
        if (!contactId)
            throw new Error("no contact provided; missing parameter 'contactId'");

        this.debug(`Loading contact address for contact #${contactId}...`);

        // cached?
        let cached = __cache.get(`${this.clientInfo.id}:contact:${contactId}`);

        if (cached) {
            this.debug(`Successfully retrieved contact address for contact #${contactId} from cache`);
            
            return cached;
        }

        // load the address
        let res = await request({
            method: 'GET',
            uri: `${this.baseUrl}/Contact/${contactId}/getMainAddress`,
            qs: {
                cft: this.cft,
                token: this[__apiTokenVar],
            },
            headers: {
                'Accept': 'application/json',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
            },
            json: true,
            gzip: true,
        });
        
        if (!res.objects)
            throw new Error(`Failed to get contact address from response: ${JSON.stringify(res)}`);

        __cache.set(`${this.clientInfo.id}:contact:${contactId}`, res.objects);

        this.debug(`Successfully loaded contact address for contact #${contactId}`);

        return res.objects;
    }

    /**
     * Creates a new instance of the importer class.
     * The instance can be used for a single import process.
     * 
     * @param {string} apiToken The sevDesk API Token to be used
     */
    constructor(apiToken) {
        if (!apiToken)
            throw new Error("No API token provided; missing parameter 'apiToken'");

        this[__apiTokenVar] = apiToken;
        this.baseUrl = "https://my.sevdesk.de/api/v1";
        this.locked = false;
        this.allContacts = null;
        this.allContactsFromCache = null;
        this.clientInfo = null;

        this.cft = uuid.v4().replace(/-/g, '');
        this.debug = debugMod(`sevDesk:voucherImporter:${this.cft}`);
    }
}


module.exports = SevdeskVoucherImporter;
