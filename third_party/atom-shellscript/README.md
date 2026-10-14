# GitHub shell grammar

The MIT-licensed `shell-unix-bash.cson` is from
https://github.com/atom/language-shellscript/tree/35dc1aa1371ab75ece08fd0837330eb62e1f9da9 .
GitHub Linguist's `vendor/grammars/language-shellscript` pointed to this commit
when checked on 2026-10-13. The original license is preserved beside it.

`grammar.json` is a JSON conversion using locked `cson-parser` 4.0.9. Only
`name` (`mdv-shell`) and `aliases` (empty) are adjusted for the Shiki registry.
No grammar rules are changed. MDV bundles the JSON; the CSON parser is a build
and validation dependency, not part of the offline renderer.

This replaces the different shell grammar shipped with Shiki, whose command
substitutions, builtins, operators and variable scopes produced observable
GitHub rendering differences.
