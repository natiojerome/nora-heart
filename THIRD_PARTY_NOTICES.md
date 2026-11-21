# Third-party notices

## Local wallet cryptography

`viem` 2.56.9 — MIT, https://github.com/wevm/viem. Used through its public
accounts/serialization APIs, not copied into Heart. Reviewed runtime dependencies:
`@noble/curves` 1.9.1, `@noble/hashes` 1.8.0, `@scure/bip32` 1.7.0,
`@scure/bip39` 1.6.0, `abitype` 1.2.3, `isows` 1.0.7, `ox` 0.14.45 and `ws`
8.21.0. Versions are locked in pnpm-lock.yaml; package notices remain intact.
No browser wallet, exchange SDK or Solana web3 SDK added to the signing runtime.

`@scure/base` 1.2.6 — MIT, https://github.com/paulmillr/scure-base,
dependency-free base58 encoding. Original MIT notices for these two direct
dependencies are retained in `docs/licenses/viem.txt` and `docs/licenses/scure-base.txt`.
Ed25519 and AES-GCM use the existing Node crypto module. The new implementation
does not incorporate source excerpts from the older Nora wallet signer.

## Browser bundles

The browser bundles below are unmodified copies of the pinned packages in
`pnpm-lock.yaml`. `pnpm web:vendor` verifies the expected package versions and
copies the bundles and license notices from installed packages. No CDN is used.

- **Marked 18.2.0** — Markdown/GFM parser, MIT.
  Source: https://github.com/markedjs/marked
  Bundle: `src/interfaces/web/public/vendor/marked.js`.
  Full notice: `src/interfaces/web/public/vendor/marked-LICENSE.txt`.
- **DOMPurify 3.4.17** — HTML sanitizer, MPL-2.0 OR Apache-2.0.
  Source: https://github.com/cure53/DOMPurify
  Bundle: `src/interfaces/web/public/vendor/purify.js`.
  Full notices: `src/interfaces/web/public/vendor/dompurify-LICENSE.txt`
  and `src/interfaces/web/public/vendor/dompurify-LICENSE-MPL.txt`.

- **KaTeX 0.19.1** — mathematical typesetting and fonts, MIT.
  Source: https://github.com/KaTeX/KaTeX.
  Unmodified browser bundle/CSS/fonts: `src/interfaces/web/public/vendor/katex/`.
  Full notice: `src/interfaces/web/public/vendor/katex/LICENSE.txt`.
  The npm package also installs commander 15 for its CLI; the browser bundle has
  no runtime import of commander. Its package retains its own MIT license.

Runtime headers and copyright notices are retained in each bundle. These
libraries are used only to present conversation text. They are independent of
the engine, model providers, memory and persistence contracts.

## External execution tools

These tools are installed as operating-system packages, not vendored in this repository:

- Bubblewrap — Linux namespace sandbox, LGPL-2.0-or-later (Ubuntu package notice: LGPL-2+).
  Upstream: https://github.com/containers/bubblewrap/.
  Keep the package's complete notices in `/usr/share/doc/bubblewrap/copyright`.
- ripgrep — code search, Unlicense OR MIT; packaged dependencies retain their own notices.
  Upstream: https://github.com/BurntSushi/ripgrep/.
  Keep `/usr/share/doc/ripgrep/copyright` when distributing the package.

Heart invokes these binaries; it copies no source from Codex CLI or either tool.
The AppArmor profile and execution adapter in this repository are Heart's own configuration/code.

## MCP client dependency

`@modelcontextprotocol/sdk` 1.32.2 — MIT, upstream:
https://github.com/modelcontextprotocol/typescript-sdk. Installed through pnpm,
not vendored; package LICENSE and transitive notices remain in installed packages.
Only its client/Streamable HTTP entry points are imported by the runtime module.
The v1 distribution includes server dependencies (Express, Hono, cors and related
packages), plus Zod, Ajv/formats, JOSE, SSE parsers, PKCE and schema utilities; their
versions are pinned in pnpm-lock.yaml. Heart still serves HTTP with node:http and
starts no Express/Hono server. No Exa server or plugin source is copied; the active search service is now self-hosted and replaceable through the connection editor.

## Self-hosted search and HTML parsing

SearXNG — AGPL-3.0-or-later, official upstream https://github.com/searxng/searxng.
The unmodified official container is pinned by digest in deploy/search.compose.yml;
no SearXNG source is copied into Heart. Keep upstream notices and source links when
distributing the image. Settings in deploy are Heart’s own configuration.

Cheerio 1.2.0, Undici 7.30.2 and ipaddr.js 2.5.0 are MIT packages installed with pnpm,
not vendored. Cheerio includes parse5/htmlparser2, DOM selectors/serialization,
encoding sniffing and related HTML utilities. The 22 added packages are pinned in
pnpm-lock.yaml and retain their notices. Parsing executes no page JavaScript.

## Agent Skills YAML parsing

`yaml` 2.9.1 — ISC, upstream https://github.com/eemeli/yaml,
documentation https://eemeli.org/yaml/. Installed through pnpm with no runtime
package dependencies; original license remains in the installed package. No
upstream implementation code is copied. The Agent Skills specification
(https://agentskills.io/specification) informs Heart's own parser/adapter;
Heart registration UUIDs remain separate from the portable `SKILL.md` files.

## Calendar scheduling

`@js-temporal/polyfill` 0.5.1 — ISC, upstream
https://github.com/js-temporal/temporal-polyfill. Its runtime dependency `jsbi`
4.3.2 is Apache-2.0 (https://github.com/GoogleChromeLabs/jsbi). Installed with pnpm,
not vendored; package notices remain intact. Only the calendar module imports
Temporal; its internal objects are not persisted as the task data format.
