# Persona voice prompts

One folder per persona; inside it, one markdown file per version. The
Reaction Joke Maker (`/humor-flavor/<id>/reaction-jokes`) reads this tree at
request time, lists every folder as a persona in folder order, and uses the
NEWEST file in each folder. Older files stay as history.

Layout:

    07-sad-girl/
      sad-girl-2026-09-07.md    ← history
      sad-girl-2026-09-08.md    ← in use

Rules:

- The two-digit folder prefix sets the order in the list.
- A version file is named `<slug>-<YYYY-MM-DD>.md`. "Newest" is the last
  file by name, which for ISO dates is the latest date. Two versions on one
  day: add a suffix after the date (`-2026-09-08b.md`) and it sorts after.
- The first level-1 heading (`# Name`) in the file names the persona. A
  parenthetical after the name is provenance and is dropped from the name:
  `# Keke Palmer (flavor 55 \`keke-palmer\`, step 4)` → "Keke Palmer".
- Everything after that heading is the voice prompt, sent to the model as
  written. Inner headings are fine.
- To revise a persona: add a newer dated file beside the old one. Do not
  edit the old one.
- To add a persona: add a folder with one dated file.

This README, and any folder or file starting with `_`, are skipped.

History: split on 2026-09-07 from one file, `persona-pov-prompts-41-55-57-58.md`;
folders with dated versions from 2026-09-08.
