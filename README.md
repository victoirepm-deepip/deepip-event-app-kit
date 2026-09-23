# deepip-event-app-kit

Starter kit for building the sales app for one DeepIP event. Each event starts
from a copy of this repo.

Private repo. No contact data, no photos of people, no exports are ever committed
here. See CLAUDE.md, section 2.

## How it is used

1. **Set up**, in a normal Claude conversation, using the phase A prompt on the
   Notion page "Event Sales App, build kit and handover". It produces a build
   brief and a filled configuration.
2. **Build**, in Claude Code, on a copy of this repo, using the phase B prompt.
   CLAUDE.md is the contract.
3. **Close out**, a few days after, with the phase C prompt.

Claude Code reads CLAUDE.md first. Do not skip it and do not edit it casually:
it is where the field lessons from Munich and Budapest are recorded.

## Files

| File | What it is |
|---|---|
| `CLAUDE.md` | The contract. Rules, interview, architecture, checklist. |
| `config.template.js` | Copy to `config.js` and fill. The only file you edit per event. |
| `PORTING.md` | One-off task list to bring the engine in from `ficpi-field`. |
| `appsscript.json` | Apps Script manifest. Never changes. |

## State of this repo

The engine (`store.js`, `auth.js`, `sync.js`, `model.js`, `ui.js`, `app.js`,
`Code.gs`) is not in here yet. It exists, proven in the field, in the private repo
`ficpi-field`, and has to be ported once, following `PORTING.md`.

That port is the first job to run in Claude Code on this repo. It is deliberately
not a copy and paste: `ficpi-field` has event-specific behaviour hardcoded where
this kit needs configuration, and its git history contains material that must not
travel. Do not fork, clone or "use as template" `ficpi-field`. Copy files.

Until the port is done, phase A works and phase B does not.
