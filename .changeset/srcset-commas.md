---
'@sanity-labs/wwwaxe': patch
---

Fix `srcset` values being rewritten when they contain commas. Data-URI stripping split the attribute on every comma and rejoined the pieces with ", ", which broke URLs such as `/fill/w_500,h_272,al_c,q_80/photo.jpg` into `w_500, h_272, al_c, q_80`. Candidates are now parsed as the HTML spec describes (a candidate's URL runs to the next whitespace, and its descriptors to the next comma outside parentheses), a `srcset` without a `data:` candidate is left byte for byte, and only `data:` candidates are removed from one that has them.
