# Pi OpenAI Codex Usage

A [Pi](https://pi.dev) extension that displays OpenAI Codex subscription usage in the terminal UI.

```text
Codex 7d ██░░░░ 37%
```

## Features

- Compact usage progress bar in Pi's footer
- Progress color shifts continuously from green through yellow to red as quota is consumed
- At 90% usage, the bar turns red and the footer automatically shows the reset countdown
- Optional detailed panel below the editor
- Primary, secondary, and code-review usage windows when available
- Reset countdowns, plan status, credits, and spend-limit information
- Automatic refresh every five minutes and after Codex agent runs
- Automatically hides when the active model is not from `openai-codex`
- Uses Pi's existing OpenAI Codex OAuth login; no separate token configuration

## Install

```bash
pi install git:github.com/muhameddelic/pi-openai-codex-usage
```

Then restart Pi or run `/reload`.

Authenticate if needed:

```text
/login openai-codex
```

Select an `openai-codex` model and the compact usage indicator will appear in the footer.

## Commands

| Command | Description |
| --- | --- |
| `/codex-usage` | Refresh usage and show a detailed notification |
| `/codex-usage refresh` | Same as above |
| `/codex-usage toggle` | Toggle the detailed panel below the editor |
| `/codex-usage show` | Show the detailed panel |
| `/codex-usage hide` | Hide the detailed panel |

The detailed-panel preference remains active when switching models, but the panel itself is only visible while an `openai-codex` model is selected.

## How it works

The extension obtains the current Codex OAuth access token through Pi's model registry and requests subscription usage from:

```text
https://chatgpt.com/backend-api/wham/usage
```

The token is not persisted or logged by the extension. It is only sent to OpenAI's ChatGPT backend with the account ID already contained in the token.

> [!NOTE]
> This is an undocumented OpenAI endpoint and may change without notice.

## Development

Load the extension directly from a checkout:

```bash
pi --no-extensions -e ./extensions/openai-codex-usage.ts
```

## License

MIT
