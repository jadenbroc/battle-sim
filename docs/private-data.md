# Private data (your own spells and monsters)

The public site ships SRD 5.2 only. Spells and monsters from books you own (for example Toll the Dead)
can still be simulated on your own machine through a private data file. It is never committed, built or deployed.

## Build it

```
npm run data:private                         # reads C:/AI Ecosystem/_shared/knowledge
npm run data:private -- --source <folder>    # a folder with spells/ and monsters/<type>/ inside
```

This writes `data/private/private-data.json` (gitignored). Only spells and monsters that are **not** in the
bundled SRD library are written; where the two libraries overlap, the SRD copy wins.

The script also reports:

- **Overlap check.** Spells and monsters present in both libraries are compared. Spells agreeing means the
  parser reads your wording the same way as the SRD wording. Monster differences usually mean 2014-era values
  or extraction slips in the library; the SRD value is used.
- **Skipped** monsters (variable stat blocks such as a Celestial Spirit's HP).
- **Warnings**, e.g. an attack bonus that was missing and was estimated as proficiency + the better of STR/DEX.
- **Problems** (bad dice, bad damage types). Any problem makes the script exit with an error.

## Use it

- **Dev server (`npm run dev`)**: a Vite middleware (`apply: 'serve'`, so absent from builds) serves
  `/__private/private-data.json` and the app loads it automatically. Status shows "Dev server".
- **Any build or hosted copy**: use **Load private data** and choose the JSON file. It is stored in this
  browser's IndexedDB only. **Remove** deletes it.

Private items are marked `private: true`. After loading, use **Suggest combat spells** in a character's
review screen to re-pick spells from the larger library.

## Safety

`src/data/privateData.test.ts` checks that `data/private/` and `public/private/` are gitignored, that
`public/private` does not exist, and that the middleware is serve-only.
