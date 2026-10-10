# Local security backport: `braces`

This vendored package is based on the upstream `braces@3.0.3` source plus the depth-limiting fix proposed in [FSDevelop/braces PR #72](https://github.com/micromatch/braces/pull/72), pinned to commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.

The upstream PR was closed without being merged or published by the maintainers. This is therefore **a local downstream backport, not an official upstream release**.

Security change: enforce a maximum nesting depth of 100 during parsing and recursive AST operations (`compile`, `expand`, and `stringify`), and reject cyclic AST parent chains. Regression tests in this repository exercise the parser and all public AST operations. CI also runs the app's full lint, typecheck, build, scanner/security, contract tests, and Cloudflare build.

The dependency version is `3.0.4-nextaction.1` solely to distinguish this reviewed local patched code from the unpatched published `3.0.3`. Do not replace it with registry `braces@3.0.3` or remove the root npm override without revisiting GHSA-vfj7-8cjw-p6xm.

When an official patched release becomes available, replace this local backport, rerun full and production-only npm audits plus all CI, and remove the vendor copy once safe.

Source license: MIT; see `LICENSE`.
