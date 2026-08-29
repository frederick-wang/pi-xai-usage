# Consumer billing uses SuperGrok OAuth only

`creditUsagePercent` is a consumer-subscription figure. An `XAI_API_KEY` is API-team billing at console.x.ai and must never be sent to `cli-chat-proxy.grok.com`. Activation requires `registry.isUsingOAuth(model)` and `registry.getProvider("xai")?.auth.oauth?.isSubscription`. Tokens come from `getProviderAuth` at fetch time (try/catch; it may refresh and persist). We do not read `auth.json` as the live token, do not implement refresh, and do not read `~/.grok/auth.json`.
