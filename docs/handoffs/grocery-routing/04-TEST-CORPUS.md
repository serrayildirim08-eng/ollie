# Grocery Routing · Test Corpus

Source: Serra dumped this real-input corpus 2026-05-22 ~01:00 +03 during E2E
shake-out. Use as the regression suite for `/route/grocery` — paste each line
into the brain-dump, confirm correct slice + intent + canonical.

Group by capability so we can ship coverage incrementally instead of trying to
nail everything in one prompt rewrite.

---

## ✅ Already covered (tonight's prompt update)

### Single-line acquire (EN)
- `need lemons`
- `buy hay`
- `need olive oil`
- `need tampons`

### Single-line pantry (EN)
- `got milk`
- `bought coffee capsules`

### Depletion → acquire (EN)
- `out of dish soap`
- `running low on coffee`
- `out of vitamin d`

### Multi-line newline-separated
- `need garlic\nneed yogurt\nbuy bell pepper for the pigs\nbuy hay\nneed tampons\nneed olive oil\nneed lemons`

### Abbreviations
- `i need tp` → toilet paper
- `out of pb` → peanut butter
- `need evoo` → olive oil

---

## ⚠️ Tonight's prompt update — verify in next test pass

### Quantity + unit extraction
- `buy 2 lemons`
- `need 6 eggs`
- `1 kg pasta`
- `big bag of hay`
- `small jar of matcha`
- `two bell peppers for the pigs`
- `a dozen eggs`
- `half a loaf of sourdough`

### Comma-separated lists
- `eggs, milk, bread`
- `tomatoes, garlic, onion`
- `hay, pellets, vitamin c`
- `tp, dish soap, sponges`
- `bananas and oat milk`
- `matcha, oat milk, honey`

### Recipe-with-context
- `making pasta tonight, need basil`
- `want to do shakshuka, need tomatoes and feta`
- `out of olive oil and i'm cooking sunday`
- `need stuff for matcha lattes`

### Pet food (still extract — pets are users too)
- `pigs are out of romaine`
- `no veggies left for tontin and pinpon`
- `two bell peppers for the pigs`

### Turkish
- `yumurta lazım` → acquire, eggs, shopping
- `kahve bitti` → acquire (depletion), coffee, shopping
- `süt almam lazım` → acquire, milk, shopping
- `matcha aldım` → pantry, matcha, pantry slice
- `tp bitti` → acquire (depletion), tp→toilet paper, shopping

### Spanish
- `necesito comprar pasta` → acquire, pasta, shopping
- `comprar leche` → acquire, milk, shopping
- `me falta café` → acquire (depletion), coffee, shopping
- `se acabó el aceite de oliva` → acquire (depletion), olive oil, shopping
- `compré pan` → pantry, bread, pantry slice
- `necesito huevos` → acquire, eggs, shopping
- `tengo que comprar tomates` → acquire, tomatoes, shopping
- `no hay heno para los cerditos` → acquire (depletion, pet food), hay, shopping
- `compré matcha` → pantry, matcha, pantry slice
- `me quedan dos limones` → ambiguous (depleting but still HAVE — best: pantry note with qty=2)
- `hace falta papel higiénico` → acquire, toilet paper, shopping

---

## 🚧 PARKED — not solvable tonight without architectural work

### Corrections (need list-context as input)
- `scratch the bread, got some`
- `remove pasta from the list`
- `got everything except eggs`
- `quita la pasta de la lista`

The `/route/grocery` endpoint today is stateless — it doesn't know the user's
current shopping list. Corrections require either (a) sending list context with
each request, or (b) a separate `/edit-list` endpoint, or (c) intent classifier
that flags `correction` and frontend handles via local state.

### Questions (need conversational mode)
- `do i need oat milk?`
- `what's on my list`
- `qué hay en mi lista`

Same root cause — needs current list context. Defer to a separate
`/query-list` endpoint or push to the chat surface.

### Out-of-domain (need rejection logic)
- `buy stock` → finance, not grocery
- `pet a dog` → not actionable at all

Need a "this isn't grocery" rejection path. Easy prompt fix: `intent: 'unknown'`
+ `items: []`. Done in this prompt update — verify.

### Vague / aspirational
- `need lunch stuff for the week`

What does "lunch stuff" mean? Bread? Cheese? Salad? Could be 10+ items. Probably
best to push back: `intent: 'unknown'` with a UI hint "tell me what you want for
lunch" — but that's UI work, not just prompt.

### Ambiguous depletion vs partial
- `me quedan dos limones` (Spanish "I have 2 lemons left")

Could mean "I have 2, that's enough" (pantry) or "I have only 2 left, buy more"
(acquire). Without intonation, prompt should prefer pantry-with-qty unless
explicit acquire verb. Document this as "pantry with low-stock annotation"
once we add a `lowStock` boolean to the schema.

---

## How to use this corpus

1. After each prompt update + worker deploy, paste each block into the brain
   dump and screenshot the resulting SHOP / PANTRY tabs.
2. Tally pass/fail per block.
3. Track regression: a fix that breaks an existing line is a regression.
4. Aim for ≥90% pass on covered blocks before declaring a tuning round done.

Aspiration: this corpus eventually becomes a worker test that hits Gemini for
real and asserts on the classification (with a small fuzz-tolerance budget for
LLM non-determinism).
