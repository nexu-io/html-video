# @html-video/runtime

Detect and invoke the coding agents used by html-video Studio. The selected agent
continues to own model selection and authentication.

## Web research with the Anthropic API agent

Select **Anthropic API (direct)** in Studio and configure `ANTHROPIC_API_KEY` (or
the existing `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` routing options). Ask for
source research when planning a video, for example:

> Research the latest public release of TypeScript and plan a three-scene video.
> Cite the release announcement and distinguish released features from proposals.

This agent has built-in `web_search` and `web_fetch` tools backed by
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).
Search uses Fast mode by default, with no Parallel account or API key required.
Inference still uses your configured model credentials. Existing CLI agents and
their own tools and settings are independent of this integration.

The model decides when to research. Only its search objectives, queries and
requested page URLs are sent to `https://search.parallel.ai/mcp`, together with a
random session identifier and the configured model name. Retrieved excerpts and
source URLs return to the model for the storyboard; web pages are untrusted source
data. Discovery is lazy, so a response that uses no research tools makes no MCP
requests. No local file, terminal or write tools are exposed.

To keep this agent's requests text-only, set `HV_WEB_SEARCH=off` before starting
Studio. Programmatic callers can also pass `context: { cwd, webSearch: false }`
to `spawnAgent`. Both controls take precedence over the default; an invalid
`HV_WEB_SEARCH` value reports an error. To use an intentional Parallel account,
set `PARALLEL_API_KEY`; it is used only for the MCP connection, separately from
model credentials.

Research has a 20-second deadline per tool operation including initial connection
and discovery, with at most eight tool calls across six model turns. Override the
deadline with `HV_WEB_SEARCH_TIMEOUT_MS` (integer, 1–120000). Cancelling the agent
also cancels research. Service errors, including anonymous free-tier quotas, are
returned to the model as tool errors so it can explain missing evidence; requests
never switch to another search provider automatically. Free access has rate limits.

## Development

From the repository root:

```sh
pnpm install
pnpm --filter @html-video/runtime test
```

The search tests run the registered agent through `spawnAgent` with scripted
Messages API responses and an MCP HTTP fixture. They check downstream source
consumption, the anonymous default, explicit credentials, disable controls,
request headers and destinations, errors, deadlines and cancellation. They do
not require paid model inference or live search.
