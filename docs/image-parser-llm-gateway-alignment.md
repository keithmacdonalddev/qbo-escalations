# Image Parser LLM Gateway Alignment

## Purpose

`qbo-escalations` now treats `llm-gateway` like a remote authenticated provider instead of a special local reachability check.

This document records the downstream contract expected by the image parser integration.

## Validation Contract

`qbo-escalations` validates `llm-gateway` with:

- `GET /v1/provider-status`

It does not use `GET /v1/models` as the primary readiness signal anymore.

The expected behavior is:

- `200` means the gateway authenticated the key and has an upstream model ready
- `401` or `403` means the API key was rejected
- `503` means the gateway authenticated the request but cannot currently serve traffic
- `504` means the gateway readiness check timed out

## Internal Status Mapping

The image parser normalizes `llm-gateway` into the same status shape used for other remote providers:

- `ok`
- `configured`
- `available`
- `code`
- `reason`
- `detail`
- `model`

For `llm-gateway`, the main codes used by the image parser status flow are:

- `OK`
- `NO_KEY`
- `INVALID_KEY`
- `PROVIDER_UNAVAILABLE`
- `TIMEOUT`

## Key Test Endpoint

`POST /api/image-parser/keys/test` now uses the same validation path for `llm-gateway` as the provider-status check.

That endpoint should return these outcomes for `llm-gateway`:

- `NO_KEY` when no key is configured
- `INVALID_KEY` when the gateway rejects the bearer token
- `PROVIDER_UNAVAILABLE` when the gateway is reachable but no upstream model is ready
- `TIMEOUT` when validation times out
- success only when the gateway is authenticated and ready

## Operator and UI Expectations

Startup logs and UI copy should not treat simple reachability as success.

Expected operator-facing states:

- `AVAILABLE (...) - Authenticated`
- `UNAVAILABLE - API key not configured`
- `UNAVAILABLE - API key rejected`
- `UNAVAILABLE - Gateway reachable, model unavailable`
- `UNAVAILABLE - Gateway validation timed out`

Expected user-facing labels:

- `Authenticated`
- `API key not configured`
- `API key rejected`
- `Gateway reachable, model unavailable`
- `Gateway validation timed out`

## Rollout Verification Notes

Phase 4 verification in this repo is limited to targeted tests and on-disk checks unless a separate runtime verification step is requested.

Recommended manual rollout check:

1. Confirm a valid `LLM_GATEWAY_API_KEY` returns `AVAILABLE (...) - Authenticated` at startup.
2. Confirm an invalid or placeholder key returns `UNAVAILABLE - API key rejected`.
3. Confirm an upstream-disconnected gateway returns `UNAVAILABLE - Gateway reachable, model unavailable` or another `PROVIDER_UNAVAILABLE` reason instead of `AVAILABLE`.
