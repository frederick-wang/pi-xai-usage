# `after_provider_response` is a refresh trigger, not a metric

xAI inference responses may carry rate-limit headers. Those headers are undocumented, often absent on `api.x.ai`, and are not the SuperGrok included allowance. The footer never shows RPM or token windows. The hook may schedule one refresh that still honors the 180s/60s throttle and the absolute Retry-After deadline. A 429 is treated as “the last call was rejected,” not as a usage percentage.
