# sevDesk Voucher Upload Library

This library provides an easy to use class to upload vouchers to a [sevDesk](http://www.sevdesk.de) account using the [sevDesk API](https://my.sevdesk.de/swaggerUI/index.html#/).

## Install

To install this library perform the following call:

```sh
npm install sevdesk-voucher-upload --save
```

The library was developed using NodeJs v8.9.x LTS. It is supposed to be compatible with the latest LTS version.

## Quickstart

The library provides a class for importing a voucher from various sources. For now, only local files are supported.

```js
var path = require('path');
var SevdeskVoucherImporter = require("sevdesk-voucher-upload");

const apiToken = '0123456mysevdeskapitoken012345';

let importer = new SevdeskVoucherImporter(apiToken);

importer.importLocalFile(path.join(__dirname, 'examples', 'R1001.pdf'));
```

All functions return a promise.

Note that the importer object cannot be reused. Create a new importer object for each import process.

## Known Issues

The library currently fails to save the voucher with "*500 - {"objects":null,"error":{"message":"Can't read file","code":null}}*" as error message. This is currently under investigation.

## sevDesk API Token

The API token can be retrieved using the web interface. Best practice is to follow this process:

1) Create a new dedicated user for the API access.
2) Give the user admin rights (only then the API token will be shown in the web interface).
3) Login using the new API user
4) Retrieve the API Token vis *Settings > Users*: https://my.sevdesk.de/#/admin/userManagement
5) Set access rights to *Vouchers/Receipts*, only

## Upload Process

This is a verbal description on the general upload process:

1) Check, if the file exists
2) Retrieve the client information from the sevDesk API
3) Upload the file to sevDesk
4) Load all contacts for matching the voucher issuer (cached for 15 minutes)
5) Extract details from voucher
6) Determine the issuer of the voucher (this library provides extended strategies compared to the sevDesk API)
7) Estimate which accounting account to use
8) Save the voucher as draft

The voucher is then available from within sevDesk.

## Debugging

The library uses the [debug](https://www.npmjs.com/package/debug) library for debug messages.

To enable debugging add "sevDesk:*" to the *DEBUG* environment variable.

## Unit Tests

To run the unit test, open a shell and set the following environment variables:

**Linux**
```sh
export DEBUG='sevDesk:*'
export SEVDESK_TOKEN='0123456mysevdeskapitoken012345'
```

**Windows (Powershell)**
```ps
$env:DEBUG='sevDesk:*'
$env:SEVDESK_TOKEN='0123456mysevdeskapitoken012345'
```

Then run the unit test command:
```sh
npm test
```

## Authors

The library is sponsored by the [marvin + konsorten GmbH](http://www.konsorten.de).

We thank all the authors who provided code to this library:

* Felix Kollmann

## License

(The MIT License)

Copyright (c) 2017 marvin + konsorten GmbH (info@konsorten.de)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
