# Activate only on provider id `xai`

Pi 0.84's builtin catalogue has one xAI provider, id `xai`. Community extensions also gate on `xai-auth`, `grok-build`, or `id.startsWith("grok-")`; those ids are not pi providers. This package paints the footer if and only if the active model's `provider` is exactly `xai`, and clears it otherwise.
