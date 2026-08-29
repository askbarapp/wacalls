# Calling service

The live calling process runs in `services/whatsapp`.

That container is the only place that constructs a `CallingEngine` (`selfhosted` | `mock` | `wavoip`). Workers and the public API never import Baileys or baileys-caller.

Internal RPC: `http://whatsapp:4010/internal/*`
