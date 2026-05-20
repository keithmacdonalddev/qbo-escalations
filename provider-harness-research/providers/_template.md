# {PROVIDER_ID} Provider Harness Contract

## Summary

- Provider path type:
- Current implementation status:
- Full package preservation status:
- Main uncertainty:

## Provider IDs In This App

- Exact app id:
- Aliases/catalog ids:
- UI labels:
- Environment variables:
- Evidence:

## Current App Call Sites

List each call site with path and line number.

- File/function:
- What it does:
- Provider path type:
- Evidence:

## Request Package Sent Today

Document what this app sends today.

- Endpoint or command:
- Auth mechanism names:
- Request body or stdin shape:
- Headers/options/args:
- Model/options:
- Timeout:
- Streaming flag:
- Evidence:

## Official Response Package

Separate official facts from source-code inference.

- Success shape:
- Error shape:
- Streaming chunk/event shape:
- Usage metadata:
- Request id/model id/finish reason fields:
- Documentation links:

## Streaming vs Non-Streaming

- Current app behavior:
- Provider capability:
- Final response detection:
- Evidence:

## Raw Package That Reaches This Server Today

Identify the first response object/string/event this server sees.

- Variable name:
- Type:
- Fields still present:
- Fields already discarded:
- Evidence:

## Proposed Mongo Storage Shape

Goal: preserve the full provider package, not extract the model answer.

Required fields:

- providerId:
- providerPathType:
- request:
- response:
- timing:
- status:
- error:

Optional/provider-specific fields:

- headers:
- rawBody:
- parsedJson:
- streamChunks:
- stdout:
- stderr:
- exitCode:
- sdkMessages:
- usage:
- providerRequestId:
- model:

Storage notes:

## Gaps And Questions

- Facts not confirmed:
- Assumptions:
- Questions for follow-up research:

## Evidence

- Source references:
- Official docs:
- Command outputs:
