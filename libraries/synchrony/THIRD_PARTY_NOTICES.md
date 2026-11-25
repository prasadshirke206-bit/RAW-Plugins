# Third-party notices

## Synchrony 2.4.5.1

The Animostream standalone plugin bundles the repository's existing
`libraries/synchrony/src/main/assets/synchrony-v2.4.5.1.js` asset so the
QuickJS plugin can reproduce the Kotlin StreamWish deobfuscation step without
requiring a separate Android-only runtime call.

- Upstream project: https://github.com/relative/synchrony
- Purpose: JavaScript-obfuscator cleaner and deobfuscator
- License: GNU General Public License v3.0
- License text: [LICENSE.md](LICENSE.md)

The generated block in `providers/anime/animostream.js` is derived from that
asset. The downloaded StreamWish `main.js` is supplied only as text to the
Synchrony AST deobfuscator; the provider does not execute that downloaded
script.
