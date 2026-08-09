# CJK segmentation profile

Use Unicode grapheme-aware width measurement. Treat wide/full-width graphemes as two display units. Do not treat a visual space between CJK and Latin text as a seam.

For Chinese, protect classifiers and heads, disposal constructions such as 把／將, causative structures such as 讓／使／叫, transitive verbs and required objects, result and direction complements, copular complements, prepositional and locative frames, modal or adverbial controllers, 得 constructions, and unfinished coordination. Chinese enumeration punctuation `、` is evidence only; split only between complete parallel semantic units.

For Japanese and Korean, do not reuse Chinese-specific grammar mechanically. Apply the shared CJK width behavior while asking the selected model to identify language-specific particles, auxiliaries, bound endings, compound predicates, names, and syntactic closures.

Keep CJK punctuation in raw linguistic text. Apply output punctuation normalization only during final rendering and only when the selected output profile requests it.
