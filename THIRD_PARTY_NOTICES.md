# Third-Party Notices

Project-owned source code is available under the MIT License in [`LICENSE`](LICENSE). The following third-party components are used under their own licenses. Versions and license identifiers were verified against the package metadata and upstream license files on 2026-08-27.

## Server runtime

| Component | Version | License | Source |
| --- | --- | --- | --- |
| PokerKit | 0.7.5 | MIT | https://github.com/uoftcprg/pokerkit |
| Pydantic | 2.11.5 | MIT | https://github.com/pydantic/pydantic |
| aiosqlite | 0.21.0 | MIT | https://github.com/omnilib/aiosqlite |
| Alembic | 1.16.1 | MIT | https://github.com/sqlalchemy/alembic |
| asyncpg | 0.30.0 | Apache-2.0 | https://github.com/MagicStack/asyncpg |
| cryptography | 45.0.2 | Apache-2.0 OR BSD-3-Clause | https://github.com/pyca/cryptography |
| FastAPI | 0.115.12 | MIT | https://github.com/fastapi/fastapi |
| pydantic-settings | 2.9.1 | MIT | https://github.com/pydantic/pydantic-settings |
| python-socketio | 5.13.0 | MIT | https://github.com/miguelgrinberg/python-socketio |
| SQLAlchemy | 2.0.41 | MIT | https://github.com/sqlalchemy/sqlalchemy |
| Uvicorn | 0.34.2 | BSD-3-Clause | https://github.com/encode/uvicorn |

Python wheels retain their upstream license files in their installed `.dist-info` directories inside the server image.

## Web runtime

| Component | Declared version | License | Source |
| --- | --- | --- | --- |
| @fontsource-variable/noto-sans-sc | ^5.2.8 | OFL-1.1 | https://github.com/fontsource/font-files |
| @fontsource/bebas-neue | ^5.2.6 | OFL-1.1 | https://github.com/fontsource/font-files |
| @noble/hashes | ^1.8.0 | MIT | https://github.com/paulmillr/noble-hashes |
| Ajv | ^8.17.1 | MIT | https://github.com/ajv-validator/ajv |
| lucide-react | ^0.468.0 | ISC | https://github.com/lucide-icons/lucide |
| Motion | ^12.0.0 | MIT | https://github.com/motiondivision/motion |
| React / React DOM | ^19.0.0 | MIT | https://github.com/facebook/react |
| Socket.IO Client | ^4.8.1 | MIT | https://github.com/socketio/socket.io |
| Zustand | ^5.0.3 | MIT | https://github.com/pmndrs/zustand |

Copyright notices required by the direct web dependencies:

- @noble/hashes: Copyright (c) 2022 Paul Miller.
- Ajv: Copyright (c) 2015-2021 Evgeny Poberezkin.
- Lucide: portions Copyright (c) Cole Bemis 2013-2022; other portions Copyright (c) Lucide Contributors 2022.
- Motion: Copyright (c) 2024 Motion B.V.
- React: Copyright (c) Meta Platforms, Inc. and affiliates.
- Socket.IO: Copyright (c) 2014-present Guillermo Rauch and Socket.IO contributors.
- Zustand: Copyright (c) 2019 Paul Henschel.
- Noto Sans SC and Bebas Neue font packages: copyright notice supplied as `Google Inc.`; distributed under the SIL Open Font License 1.1.

The MIT, ISC and OFL-1.1 terms required by the distributed web assets follow this inventory. Apache-2.0 and BSD-3-Clause terms remain included in the installed server dependency artifacts.

## Container images

| Image | License | Source |
| --- | --- | --- |
| Python 3.12 slim | PSF-2.0 and image component licenses | https://github.com/docker-library/python |
| Node.js 22 Alpine | MIT and image component licenses | https://github.com/nodejs/docker-node |
| Caddy 2.10 Alpine | Apache-2.0 and image component licenses | https://github.com/caddyserver/caddy |
| PostgreSQL 16 Alpine | PostgreSQL License and image component licenses | https://github.com/docker-library/postgres |

Container base images also include Alpine or Debian packages governed by their package-level notices. Those notices remain available inside each image.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## SIL Open Font License 1.1

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership with
others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The fonts,
including any derivative works, can be bundled, embedded, redistributed and/or
sold with any software provided that any reserved names are not used by
derivative works. The fonts and derivatives, however, cannot be released under
any other type of license. The requirement for fonts to remain under this
license does not apply to any document created using the fonts or their
derivatives.

DEFINITIONS

"Font Software" refers to the set of files released by the Copyright Holder(s)
under this license and clearly marked as such. This may include source files,
build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright
statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or
substituting -- in part or in whole -- any of the components of the Original
Version, by changing formats or by porting the Font Software to a new
environment.

"Author" refers to any designer, engineer, programmer, technical writer or
other person who contributed to the Font Software.

PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining a copy of
the Font Software, to use, study, copy, merge, embed, modify, redistribute, and
sell modified and unmodified copies of the Font Software, subject to the
following conditions:

1) Neither the Font Software nor any of its individual components, in Original
or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy contains
the above copyright notice and this license. These can be included either as
stand-alone text files, human-readable headers or in the appropriate
machine-readable metadata fields within text or binary files as long as those
fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s)
unless explicit written permission is granted by the corresponding Copyright
Holder. This restriction only applies to the primary font name as presented to
the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software
shall not be used to promote, endorse or advertise any Modified Version, except
to acknowledge the contribution(s) of the Copyright Holder(s) and the Author(s)
or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be
distributed entirely under this license, and must not be distributed under any
other license. The requirement for fonts to remain under this license does not
apply to any document created using the Font Software.

TERMINATION

This license becomes null and void if any of the above conditions are not met.

DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL,
INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE
THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.
