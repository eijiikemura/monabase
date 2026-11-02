# Patched minimatch compatibility bridge

Development tools in this project use both the legacy callable CommonJS export
and the modern named exports of minimatch. The patched upstream v11 exposes
named exports, so replacing every old dependency with v11 directly breaks tools
such as ESLint's React rules, directory comparison and ASAR packaging.

This private local package delegates both interfaces to the unmodified upstream
`minimatch@11.0.3`, installed under the `minimatch-v11` npm alias. It contains no
matching implementation or advisory suppression. For legacy glob v7 it adds raw
pattern metadata and a `Symbol.match` adapter to upstream's compiled matchers;
matching still uses upstream's nonrecursive `test()` instead of a generated regex.
The ESM entry point exposes the same named exports and callable default export
as the CommonJS bridge. They share constructors and the `GLOBSTAR` symbol.
The root override references the root dev dependency so npm resolves the local
package consistently instead of resolving relative paths inside each consumer.

Keep `package-lock.json` and this directory together. Test clean installation,
ESLint, translation extraction, glob traversal, directory comparison and ASAR
packing when changing the bridge or upstream version. Remove it once all
consuming tools support patched upstream versions natively. This is a build-time
dependency; the application does not import it.
