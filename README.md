# Apex Load Testing

k6-based load tests for Apex microservices.

## Prerequisites

```bash
brew install k6
```

## Usage

```bash
export TARGET=https://upload-api-xxxxx-uc.a.run.app
export TOKEN=$(gcloud auth print-identity-token)

# Run upload service scenarios
just upload-ramp TARGET=$TARGET TOKEN=$TOKEN
just upload-spike TARGET=$TARGET TOKEN=$TOKEN
just upload-sustained TARGET=$TARGET TOKEN=$TOKEN

# Or run all three sequentially
just upload-all TARGET=$TARGET TOKEN=$TOKEN
```

## Adding a new service

1. Create `services/<name>/scenarios/`
2. Write scenario files importing from `lib/`
3. Add `Justfile` targets
